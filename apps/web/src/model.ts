/**
 * 画面のロジック（DOM に触れない純粋関数）。
 * すべてブラウザ内で完結し、入力された設定をどこにも送らない。
 */
import {
  HINT_PATTERNS,
  MASK_MARKER_RE,
  assessRisk,
  compose,
  containsMasked,
  createBundle,
  createPost,
  decompose,
  describeItem,
  isPlainObject,
  itemDependencies,
  maskSettings,
  maskedItemPairs,
  validateSettings,
  walkStrings,
  type Dependency,
  type ImportBundle,
  type Item,
  type MaskFinding,
  type Notes,
  type PostMeta,
  type RiskAssessment,
  type RiskLevel,
  type Settings,
  type SharePost,
  type Warning,
} from "@ccpick/core";

// ---------------------------------------------------------------------------
// 入力

export type ParseResult =
  | { ok: true; settings: Settings; warnings: Warning[] }
  | { ok: false; error: string; line?: number; column?: number };

export function parseInput(text: string): ParseResult {
  if (text.trim() === "") return { ok: false, error: "settings.json の中身を貼り付けてください" };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (e) {
    const msg = (e as Error).message;
    const pos = /position (\d+)/.exec(msg)?.[1];
    if (pos !== undefined) {
      const before = text.slice(0, Number(pos));
      const line = before.split("\n").length;
      const column = Number(pos) - before.lastIndexOf("\n");
      return { ok: false, error: `JSON として読めません（${line} 行 ${column} 文字目付近）`, line, column };
    }
    return { ok: false, error: `JSON として読めません: ${msg}` };
  }
  if (!isPlainObject(value)) return { ok: false, error: "settings.json はオブジェクト（{ ... }）である必要があります" };
  const v = validateSettings(value);
  if (!v.ok) return { ok: false, error: v.errors.join("\n") };
  return { ok: true, settings: value, warnings: v.warnings };
}

// ---------------------------------------------------------------------------
// 項目の一覧

export interface Options {
  mask: boolean;
  /** 値を公開してよい env のキー */
  publicEnv: string[];
}

export interface Row {
  /** 選択や注釈の状態を持つキー。マスクの有無で変わらないよう、元の項目 ID を使う */
  key: string;
  /** 表示・書き出しに使う項目（マスクが有効ならマスク後） */
  item: Item;
  original: Item;
  group: string;
  risk: RiskAssessment;
  description?: string;
  /** マスク値を含む（取り込む側で値の入力が必要） */
  hasMasked: boolean;
  /** マスクで変わった */
  changedByMask: boolean;
  deps: Dependency[];
}

export interface Model {
  rows: Row[];
  findings: MaskFinding[];
  envKeys: string[];
  warnings: Warning[];
}

export function buildModel(settings: Settings, opts: Options): Model {
  const d = decompose(settings);
  const envKeys = isPlainObject(settings.env) ? Object.keys(settings.env) : [];
  let pairs: { original: Item; masked: Item | undefined }[];
  let findings: MaskFinding[] = [];
  if (opts.mask) {
    const m = maskSettings(settings, { publicEnvKeys: opts.publicEnv });
    findings = m.findings;
    pairs = maskedItemPairs(settings, m.settings);
  } else {
    pairs = d.items.map((i) => ({ original: i, masked: i }));
  }
  const rows: Row[] = [];
  for (const { original, masked } of pairs) {
    // マスクで他の項目と同じになった項目は書き出せないので一覧から外す
    if (!masked) continue;
    const row: Row = {
      key: original.id,
      item: masked,
      original,
      group: groupOf(original),
      risk: assessRisk(original),
      hasMasked: containsMasked(masked.value),
      changedByMask: masked.id !== original.id || JSON.stringify(masked.value) !== JSON.stringify(original.value),
      deps: itemDependencies(masked),
    };
    const desc = describeItem(original);
    if (desc) row.description = desc;
    rows.push(row);
  }
  return { rows, findings, envKeys, warnings: d.warnings };
}

/** 一覧の見出し。permissions と hooks は中の種類ごとに分ける */
export function groupOf(item: Item): string {
  const [top, sub] = item.path;
  if (top === "permissions" && sub && item.kind === "array-element") return `permissions.${sub}`;
  if (top === "hooks" && sub) return `hooks.${sub}`;
  if (top === "permissions" || top === "env" || top === "hooks") return top;
  return item.kind === "other" ? "スキーマにないキー" : "その他の設定";
}

/** 項目の見出しに出す短いラベル */
export function rowLabel(row: Row): string {
  const item = row.item;
  switch (item.kind) {
    case "array-element":
      return String(item.value);
    case "hook": {
      const m = item.hook?.matcher;
      return m === undefined ? "（matcher なし）" : `matcher: ${m}`;
    }
    case "map-entry":
      return item.path[1] ?? item.id;
    default:
      return item.path.join(".");
  }
}

/** 値の表示。配列要素はラベルと同じなので出さない */
export function rowValueText(row: Row): string | undefined {
  const item = row.item;
  if (item.kind === "array-element") return undefined;
  if (item.kind === "hook" && isPlainObject(item.value)) {
    const v = item.value;
    const main = typeof v.command === "string" ? v.command : typeof v.prompt === "string" ? v.prompt : undefined;
    const rest = Object.fromEntries(Object.entries(v).filter(([k]) => k !== "command" && k !== "prompt"));
    const tail = Object.keys(rest).length > 0 ? `\n${JSON.stringify(rest)}` : "";
    return main !== undefined ? main + tail : JSON.stringify(v, null, 2);
  }
  return typeof item.value === "string" ? item.value : JSON.stringify(item.value, null, 2);
}

// ---------------------------------------------------------------------------
// ハイライト

export interface Segment {
  text: string;
  kind: "plain" | "masked" | "hint";
  title?: string;
}

/** マスクマーカーと、確認してほしい箇所（ホスト名など）を区切る */
export function highlightSegments(text: string): Segment[] {
  const marks: { start: number; end: number; kind: "masked" | "hint"; title: string }[] = [];
  for (const m of text.matchAll(new RegExp(MASK_MARKER_RE.source, "g"))) {
    marks.push({ start: m.index, end: m.index + m[0].length, kind: "masked", title: "マスクした値" });
  }
  for (const h of HINT_PATTERNS) {
    for (const m of text.matchAll(new RegExp(h.re.source, h.re.flags.includes("g") ? h.re.flags : `${h.re.flags}g`))) {
      const start = m.index;
      const end = start + m[0].length;
      if (marks.some((x) => start < x.end && end > x.start)) continue;
      marks.push({ start, end, kind: "hint", title: h.reason });
    }
  }
  marks.sort((a, b) => a.start - b.start);
  const out: Segment[] = [];
  let pos = 0;
  for (const m of marks) {
    if (m.start > pos) out.push({ text: text.slice(pos, m.start), kind: "plain" });
    out.push({ text: text.slice(m.start, m.end), kind: m.kind, title: m.title });
    pos = m.end;
  }
  if (pos < text.length) out.push({ text: text.slice(pos), kind: "plain" });
  return out;
}

/** 項目の値に含まれるヒント（ホスト名など）の数 */
export function hintCount(row: Row): number {
  let n = 0;
  for (const { value } of walkStrings(row.item.value)) n += highlightSegments(value).filter((s) => s.kind === "hint").length;
  return n;
}

// ---------------------------------------------------------------------------
// 絞り込み

export interface Filter {
  risk: RiskLevel | "all";
  query: string;
  onlySelected: boolean;
}

export function filterRows(rows: Row[], f: Filter, selected: Set<string>): Row[] {
  const q = f.query.trim().toLowerCase();
  return rows.filter(
    (r) =>
      (f.risk === "all" || r.risk.level === f.risk) &&
      (!f.onlySelected || selected.has(r.key)) &&
      (q === "" || `${r.item.id}\n${JSON.stringify(r.item.value)}\n${r.description ?? ""}`.toLowerCase().includes(q)),
  );
}

// ---------------------------------------------------------------------------
// 書き出し

export interface Summary {
  selected: number;
  high: number;
  masked: number;
}

export function summarize(rows: Row[], selected: Set<string>): Summary {
  const sel = rows.filter((r) => selected.has(r.key));
  return {
    selected: sel.length,
    high: sel.filter((r) => r.risk.level === "high").length,
    masked: sel.filter((r) => r.hasMasked).length,
  };
}

function selectedRows(rows: Row[], selected: Set<string>): Row[] {
  return rows.filter((r) => selected.has(r.key));
}

/** 注釈（元の項目 ID がキー）を、書き出す項目の ID がキーの形にする */
function notesFor(rows: Row[], notes: Record<string, string>): Notes {
  const out: Notes = {};
  for (const r of rows) {
    const why = notes[r.key]?.trim();
    if (why) out[r.item.id] = { why };
  }
  return out;
}

export function buildBundle(
  rows: Row[],
  selected: Set<string>,
  notes: Record<string, string>,
  source?: ImportBundle["source"],
  now = new Date(),
): ImportBundle {
  const sel = selectedRows(rows, selected);
  return createBundle(
    sel.map((r) => r.item),
    { notes: notesFor(sel, notes), createdAt: now.toISOString(), ...(source ? { source } : {}) },
  );
}

/** 投稿用 JSON。マスクが無効だと作れない（createPost が秘密の残りを検査して止める） */
export function buildPost(
  rows: Row[],
  selected: Set<string>,
  notes: Record<string, string>,
  meta: PostMeta,
  publicEnv: string[],
): SharePost {
  const sel = selectedRows(rows, selected);
  return createPost(compose(sel.map((r) => r.item)), notesFor(sel, notes), meta, { publicEnvKeys: publicEnv });
}

export function toJsonText(v: unknown): string {
  return `${JSON.stringify(v, null, 2)}\n`;
}

/** 選択の一括操作 */
export function selectWhere(rows: Row[], pred: (r: Row) => boolean): Set<string> {
  return new Set(rows.filter(pred).map((r) => r.key));
}
