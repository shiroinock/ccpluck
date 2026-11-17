/**
 * 「もらう」側の判断を助ける純粋関数。
 * 他人の投稿を自分の設定と比べ、次に見る項目をシステムが決めて 1 件ずつ出す（タイムライン）。
 */
import { BUNDLE_FORMAT, POST_FORMAT, parseBundle, type ImportBundle, type Notes, type PostMeta } from "./bundle.js";
import { decompose, getItemValue, type Item } from "./items.js";
import { deepEqual, isPlainObject, type JsonValue, type Settings, type Warning } from "./json.js";
import { assessRisk, type RiskAssessment } from "./risk.js";
import { validateSettings } from "./validate.js";

// ---------------------------------------------------------------------------
// 入力

export interface PickSource {
  /** 何として読んだか */
  kind: "post" | "bundle" | "settings";
  items: Item[];
  /** 作者の注釈（項目 ID → 理由） */
  notes: Notes;
  meta?: PostMeta;
  source?: ImportBundle["source"];
  errors: string[];
  warnings: Warning[];
}

/**
 * もらう側の入力を読む。投稿（ccpick-post）、import バンドル、素の settings.json のどれでもよい。
 * 外部から来た JSON なので、形の検証は parseBundle / validateSettings に任せる。
 */
export function parsePickSource(raw: unknown): PickSource {
  if (isPlainObject(raw) && (raw.format === POST_FORMAT || raw.format === BUNDLE_FORMAT)) {
    const b = parseBundle(raw);
    const res: PickSource = {
      kind: raw.format === POST_FORMAT ? "post" : "bundle",
      items: b.items,
      notes: b.notes,
      errors: b.errors,
      warnings: b.warnings,
    };
    if (b.source) res.source = b.source;
    if (raw.format === POST_FORMAT && isPlainObject(raw.meta)) res.meta = readMeta(raw.meta);
    return res;
  }
  const v = validateSettings(raw);
  if (!v.ok) return { kind: "settings", items: [], notes: {}, errors: v.errors, warnings: v.warnings };
  const d = decompose(raw as Settings);
  return { kind: "settings", items: d.items, notes: {}, errors: [], warnings: [...v.warnings, ...d.warnings] };
}

function readMeta(m: Record<string, JsonValue>): PostMeta {
  const meta: PostMeta = {};
  if (typeof m.title === "string") meta.title = m.title;
  if (typeof m.os === "string") meta.os = m.os as PostMeta["os"];
  if (Array.isArray(m.tags)) meta.tags = m.tags.filter((t): t is string => typeof t === "string");
  if (typeof m.license === "string") meta.license = m.license;
  return meta;
}

// ---------------------------------------------------------------------------
// 自分の設定との比較

/** 自分の settings.json と比べた結果 */
export type MineStatus = { kind: "new" } | { kind: "same" } | { kind: "differs"; value: JsonValue };

export function compareWithMine(item: Item, mine: Settings): MineStatus {
  const v = getItemValue(mine, item.id);
  if (v === undefined) return { kind: "new" };
  // 配列要素と hook は「同じものがある」＝取り込んでも変わらない（hook は同じコマンドなら重複扱い）
  if (item.kind === "array-element" || item.kind === "hook" || deepEqual(v, item.value)) return { kind: "same" };
  return { kind: "differs", value: v };
}

// ---------------------------------------------------------------------------
// 並び順

export interface Attention {
  /** 小さいほど先に出す */
  rank: number;
  /** なぜこの順番で出しているか（カードに表示する） */
  reason: string;
}

/** 同じ設定をすでに持っている項目の rank。タイムラインには出さない */
export const RANK_ALREADY = 9;

/**
 * もらう側の順。自分に足りないもの・作者が理由を書いているものを先に出す。
 * 1. 作者の理由があり、自分にない  2. 自分にない  3. その他  4. 値が違う（置き換えになるので慎重に）
 */
export function pickAttention(c: { mine?: MineStatus; why?: string }): Attention {
  const m = c.mine?.kind;
  if (m === "same") return { rank: RANK_ALREADY, reason: "同じ設定をすでに持っています" };
  if (m === "differs") return { rank: 3, reason: "あなたの設定と値が違います" };
  if (c.why) return { rank: 0, reason: m === "new" ? "あなたの設定になく、作者が理由を書いています" : "作者が理由を書いています" };
  if (m === "new") return { rank: 1, reason: "あなたの設定にない項目です" };
  return { rank: 2, reason: "この投稿の項目です" };
}

export interface PickCandidate {
  item: Item;
  risk: RiskAssessment;
  mine: MineStatus;
  /** 作者が書いた「なぜ」 */
  why?: string;
  attention: Attention;
}

/** 項目を自分の設定と比べ、注意の順に並べる（同じ順位の中では投稿に書かれた順） */
export function pickCandidates(items: Item[], notes: Notes, mine: Settings): PickCandidate[] {
  return items
    .map((item, i) => {
      const why = Object.hasOwn(notes, item.id) ? notes[item.id]?.why?.trim() : undefined;
      const mineStatus = compareWithMine(item, mine);
      const c: PickCandidate = {
        item,
        risk: assessRisk(item),
        mine: mineStatus,
        attention: pickAttention({ mine: mineStatus, ...(why ? { why } : {}) }),
      };
      if (why) c.why = why;
      return { c, i };
    })
    .sort((x, y) => x.c.attention.rank - y.c.attention.rank || x.i - y.i)
    .map((x) => x.c);
}

// ---------------------------------------------------------------------------
// 1 件ずつ決める（タイムライン）

export type PickDecision = "in" | "out";

export interface PickState {
  /** 決めた結果（項目 ID → 決定） */
  decisions: Record<string, PickDecision>;
  /** 決めた順。z で戻すときに使う */
  log: string[];
  /** あとで回しにした順 */
  deferred: string[];
}

export const emptyPickState = (): PickState => ({ decisions: {}, log: [], deferred: [] });

export interface PickView {
  /** いま見る項目。すべて決め終えたら undefined */
  current: PickCandidate | undefined;
  /** current があとで回しにしたものか */
  currentIsDeferred: boolean;
  /** タイムラインに出す件数（すでに持っている項目を除く） */
  total: number;
  /** 決めた件数 */
  decided: number;
  /** すでに持っているので出さない項目 */
  already: PickCandidate[];
}

/** 次に見る項目を決める。candidates は pickCandidates の順であること */
export function pickView(candidates: PickCandidate[], state: PickState): PickView {
  const shown = candidates.filter((c) => c.attention.rank !== RANK_ALREADY);
  const undecided = shown.filter((c) => !Object.hasOwn(state.decisions, c.item.id));
  const deferred = new Set(state.deferred);
  const fresh = undecided.filter((c) => !deferred.has(c.item.id));
  const later = state.deferred.flatMap((id) => undecided.filter((c) => c.item.id === id));
  const current = fresh[0] ?? later[0];
  return {
    current,
    currentIsDeferred: fresh.length === 0 && current !== undefined,
    total: shown.length,
    decided: shown.length - undecided.length,
    already: candidates.filter((c) => c.attention.rank === RANK_ALREADY),
  };
}

export function decide(state: PickState, id: string, d: PickDecision): PickState {
  return {
    decisions: { ...state.decisions, [id]: d },
    log: [...state.log.filter((x) => x !== id), id],
    deferred: state.deferred.filter((x) => x !== id),
  };
}

export function deferPick(state: PickState, id: string): PickState {
  return { ...state, deferred: [...state.deferred.filter((x) => x !== id), id] };
}

/** 最後に決めたものを未決に戻す。戻すものがなければそのまま */
export function undoPick(state: PickState): PickState {
  const last = state.log[state.log.length - 1];
  if (last === undefined) return state;
  const decisions = { ...state.decisions };
  delete decisions[last];
  return { decisions, log: state.log.slice(0, -1), deferred: state.deferred };
}

// ---------------------------------------------------------------------------
// 表示用（Web と CLI で同じ呼び方をする）

/** 項目の種類の見出し。permissions と hooks は中の種類ごとに分ける */
export function itemGroup(item: Item): string {
  const [top, sub] = item.path;
  if (top === "permissions" && sub && item.kind === "array-element") return `permissions.${sub}`;
  if (top === "hooks" && sub) return `hooks.${sub}`;
  if (top === "permissions" || top === "env" || top === "hooks") return top;
  return item.kind === "other" ? "スキーマにないキー" : "その他の設定";
}

/** 項目の短いラベル */
export function itemLabel(item: Item): string {
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
export function itemValueText(item: Item): string | undefined {
  if (item.kind === "array-element") return undefined;
  if (item.kind === "hook" && isPlainObject(item.value)) {
    const v = item.value;
    const main = typeof v.command === "string" ? v.command : typeof v.prompt === "string" ? v.prompt : undefined;
    const rest = Object.fromEntries(Object.entries(v).filter(([k]) => k !== "command" && k !== "prompt" && k !== "type"));
    const tail = Object.keys(rest).length > 0 ? `\n${JSON.stringify(rest)}` : "";
    return main !== undefined ? main + tail : JSON.stringify(v, null, 2);
  }
  return typeof item.value === "string" ? item.value : JSON.stringify(item.value, null, 2);
}
