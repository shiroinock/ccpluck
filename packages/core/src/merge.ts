import { itemDependencies, type Dependency } from "./deps.js";
import { clone, deepEqual, type JsonValue, type Settings, type Warning } from "./json.js";
import {
  TargetError,
  getItemValue,
  itemFromId,
  removeInPlace,
  upsertInPlace,
  type Item,
} from "./items.js";
import { containsMasked } from "./mask.js";
import { assessRisk, type RiskRule } from "./risk.js";

export type ConflictDecision = "overwrite" | "skip";

export interface MergeOptions {
  /** 衝突した項目ごとの判断。未指定の衝突は適用しない（unresolved として返す） */
  decisions?: Record<string, ConflictDecision>;
  /** 内容を確認済みの high リスク項目 ID。含まれていない high 項目は適用しない */
  confirmedHighRisk?: string[];
  riskRules?: RiskRule[];
}

/** ジャーナルの 1 行。CLI はこれに importId を付けて保存する */
export interface JournalOp {
  itemId: string;
  op: "add" | "replace";
  before?: JsonValue;
  after: JsonValue;
}

export type SkipReason =
  | "unchanged" // 同じ値がすでにある
  | "duplicate" // 同じ要素・同じ hook コマンドがすでにある
  | "conflict-skip" // 衝突してユーザーがスキップを選んだ
  | "conflict-unresolved" // 衝突していて判断がない
  | "needs-confirmation" // high リスクで未確認
  | "masked" // マスク値が残っている
  | "invalid-target"; // 既存の settings の形が合わず適用できない

export interface Conflict {
  itemId: string;
  existing: JsonValue;
  incoming: JsonValue;
  decision?: ConflictDecision;
}

export interface MergeResult {
  settings: Settings;
  applied: JournalOp[];
  skipped: { itemId: string; reason: SkipReason; detail?: string }[];
  conflicts: Conflict[];
  warnings: Warning[];
  /** 適用した項目が参照しているスクリプト。存在確認は呼び出し側（CLI）で行う */
  dependencies: Dependency[];
}

// ---------------------------------------------------------------------------
// permission ルールの矛盾検出

interface ParsedRule {
  tool: string;
  content?: string;
}

export function parsePermissionRule(rule: string): ParsedRule {
  const m = /^([^()]+?)\s*(?:\((.*)\))?$/s.exec(rule.trim());
  if (!m) return { tool: rule.trim() };
  return m[2] === undefined ? { tool: m[1] as string } : { tool: m[1] as string, content: m[2] };
}

/** a が b を包含するか（a の方が広い、または同じ） */
function covers(a: ParsedRule, b: ParsedRule): boolean {
  if (a.tool === "*") return true;
  if (a.tool !== b.tool) return false;
  if (a.content === undefined || ["*", ":*", ""].includes(a.content.trim())) return true;
  if (b.content === undefined) return false;
  if (a.content === b.content) return true;
  if (a.content.endsWith("*")) {
    const prefix = a.content.slice(0, -1).replace(/:$/, "").trimEnd();
    return b.content.startsWith(prefix);
  }
  return false;
}

/** 2 つのルールが同じ操作に当てはまりうるか */
export function rulesOverlap(a: string, b: string): boolean {
  const pa = parsePermissionRule(a);
  const pb = parsePermissionRule(b);
  return covers(pa, pb) || covers(pb, pa);
}

function permissionWarnings(settings: Settings, item: Item): Warning[] {
  if (item.kind !== "array-element" || item.path[0] !== "permissions") return [];
  const list = item.path[1];
  const opposite = list === "allow" ? "deny" : list === "deny" ? "allow" : undefined;
  if (!opposite || typeof item.value !== "string") return [];
  const perms = settings.permissions;
  const others =
    perms && typeof perms === "object" && !Array.isArray(perms) && Array.isArray(perms[opposite])
      ? (perms[opposite] as JsonValue[]).filter((x): x is string => typeof x === "string")
      : [];
  return others
    .filter((o) => rulesOverlap(item.value as string, o))
    .map((o) => ({
      code: "permission-contradiction",
      message: `取り込む ${list} ルール "${item.value}" が既存の ${opposite} ルール "${o}" と重なります（deny が優先されます）`,
      at: item.id,
    }));
}

// ---------------------------------------------------------------------------

/**
 * base に items をマージする。base は変更しない。
 * 項目の並び順に適用し、新しい要素は既存の後ろに追加する。
 */
export function mergeItems(base: Settings, items: Item[], options: MergeOptions = {}): MergeResult {
  const settings = clone(base);
  const result: MergeResult = {
    settings,
    applied: [],
    skipped: [],
    conflicts: [],
    warnings: [],
    dependencies: [],
  };
  const confirmed = new Set(options.confirmedHighRisk ?? []);

  for (const item of items) {
    const skip = (reason: SkipReason, detail?: string) =>
      result.skipped.push(detail === undefined ? { itemId: item.id, reason } : { itemId: item.id, reason, detail });

    if (containsMasked(item.value)) {
      skip("masked", "マスクされた値が含まれています。値を入力するかスキップしてください");
      continue;
    }

    let existing: JsonValue | undefined;
    try {
      existing = getItemValue(settings, item.id);
    } catch (e) {
      skip("invalid-target", (e as Error).message);
      continue;
    }

    let op: JournalOp["op"];
    if (existing === undefined) {
      op = "add";
    } else if (item.kind === "array-element" || item.kind === "hook") {
      skip(deepEqual(existing, item.value) ? "unchanged" : "duplicate");
      continue;
    } else if (deepEqual(existing, item.value)) {
      skip("unchanged");
      continue;
    } else {
      const decision = options.decisions?.[item.id];
      const conflict: Conflict = { itemId: item.id, existing: clone(existing), incoming: clone(item.value) };
      if (decision) conflict.decision = decision;
      result.conflicts.push(conflict);
      if (decision !== "overwrite") {
        skip(decision === "skip" ? "conflict-skip" : "conflict-unresolved");
        continue;
      }
      op = "replace";
    }

    const risk = assessRisk(item, options.riskRules);
    if (risk.level === "high" && !confirmed.has(item.id)) {
      skip("needs-confirmation", risk.matched.map((m) => m.reason).join(" / "));
      continue;
    }

    try {
      upsertInPlace(settings, item);
    } catch (e) {
      if (e instanceof TargetError) {
        skip("invalid-target", e.message);
        continue;
      }
      throw e;
    }

    result.warnings.push(...permissionWarnings(settings, item));
    result.dependencies.push(...itemDependencies(item));
    const journal: JournalOp = { itemId: item.id, op, after: clone(item.value) };
    if (existing !== undefined) journal.before = clone(existing);
    result.applied.push(journal);
  }
  return result;
}

// ---------------------------------------------------------------------------
// 巻き戻し

export interface RevertResult {
  settings: Settings;
  reverted: string[];
  /** 適用後に手で変更されていたため戻さなかった項目 */
  conflicts: { itemId: string; expected: JsonValue; actual: JsonValue | undefined }[];
}

/**
 * ジャーナルの操作を逆順に取り消す。current は変更しない。
 * 現在の値が after と違う（適用後に手で変更された）項目は戻さず conflicts に入れる。
 */
export function revertOps(current: Settings, ops: JournalOp[]): RevertResult {
  const settings = clone(current);
  const res: RevertResult = { settings, reverted: [], conflicts: [] };
  for (const op of [...ops].reverse()) {
    const actual = getItemValue(settings, op.itemId);
    if (!deepEqual(actual, op.after)) {
      res.conflicts.push({ itemId: op.itemId, expected: clone(op.after), actual: clone(actual) });
      continue;
    }
    if (op.op === "add" || op.before === undefined) removeInPlace(settings, op.itemId);
    else upsertInPlace(settings, itemFromId(op.itemId, op.before));
    res.reverted.push(op.itemId);
  }
  return res;
}
