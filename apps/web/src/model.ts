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
  POST_FORMAT,
  describeItem,
  isPlainObject,
  itemDependencies,
  maskSettings,
  maskedItemPairs,
  pickAttention,
  publishAttention,
  itemGroup,
  itemLabel,
  itemValueText,
  compareWithMine,
  type MineStatus,
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
  type JsonValue,
  type Warning,
} from "@ccpluck/core";

/** 画面の目的。もらう＝他人の設定から取り込む／公開する＝自分の設定を投稿する */
export type Purpose = "pick" | "publish";

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

/** 他人の投稿として読み込んだもの */
export interface Source {
  settings: Settings;
  /** 作者の注釈（項目 ID → 理由） */
  notes: Notes;
  meta?: PostMeta;
  /** ccpluck の投稿形式だったか（素の settings.json なら false） */
  isPost: boolean;
  warnings: Warning[];
}

/**
 * 「もらう」側の入力。ccpluck の投稿（export --mask や公開画面の出力）と、素の settings.json のどちらも受け付ける。
 */
export function parseSource(text: string): { ok: true; source: Source } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    const r = parseInput(text);
    return r.ok ? { ok: false, error: "読めません" } : { ok: false, error: r.error };
  }
  if (isPlainObject(raw) && raw.format === POST_FORMAT) {
    const r = parseInput(JSON.stringify(raw.settings ?? null));
    if (!r.ok) return { ok: false, error: `投稿の settings が不正です: ${r.error}` };
    const notes: Notes = {};
    if (isPlainObject(raw.notes)) {
      for (const [id, n] of Object.entries(raw.notes)) {
        if (isPlainObject(n) && typeof n.why === "string") {
          Object.defineProperty(notes, id, { value: { why: n.why }, enumerable: true, writable: true, configurable: true });
        }
      }
    }
    const source: Source = { settings: r.settings, notes, isPost: true, warnings: r.warnings };
    if (isPlainObject(raw.meta)) {
      const m = raw.meta;
      const meta: PostMeta = {};
      if (typeof m.title === "string") meta.title = m.title;
      if (typeof m.os === "string") meta.os = m.os as PostMeta["os"];
      if (Array.isArray(m.tags)) meta.tags = m.tags.filter((t): t is string => typeof t === "string");
      if (typeof m.license === "string") meta.license = m.license;
      source.meta = meta;
    }
    return { ok: true, source };
  }
  const r = parseInput(text);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, source: { settings: r.settings, notes: {}, isPost: false, warnings: r.warnings } };
}

// ---------------------------------------------------------------------------
// 項目の一覧

export interface Options {
  mask: boolean;
  /** 値を公開してよい env のキー */
  publicEnv: string[];
  /** 比べる相手（もらう側の、自分の settings.json） */
  mine?: Settings;
  /** 作者の注釈 */
  authorNotes?: Notes;
}

/** 自分の settings.json との比較は core と共通 */
export { compareWithMine, type MineStatus } from "@ccpluck/core";

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
  /** 自分の settings.json と比べた結果（比べる相手がないときは undefined） */
  mine?: MineStatus;
  /** 作者が書いた「なぜ」 */
  authorWhy?: string;
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
    if (opts.mine) row.mine = compareWithMine(masked, opts.mine);
    const why = opts.authorNotes?.[original.id]?.why?.trim();
    if (why) row.authorWhy = why;
    rows.push(row);
  }
  return { rows, findings, envKeys, warnings: d.warnings };
}

/** 一覧の見出し。permissions と hooks は中の種類ごとに分ける */
export function groupOf(item: Item): string {
  return itemGroup(item);
}

/** 項目の見出しに出す短いラベル */
export function rowLabel(row: Row): string {
  return itemLabel(row.item);
}

/** 値の表示。配列要素はラベルと同じなので出さない */
export function rowValueText(row: Row): string | undefined {
  return itemValueText(row.item);
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

// ---------------------------------------------------------------------------
// タイムライン（システムが「次に見るもの」を決めて 1 件ずつ出す）

export type Decision = "in" | "out";

export interface Attention {
  /** 小さいほど先に出す */
  rank: number;
  /** なぜこの順番で出しているか（カードに表示する） */
  reason: string;
}

/**
 * 先に見てほしい順。公開して困るもの・取り込むと危ないものを先に出す。
 * 1. マスク値を含む（公開してよいか、取り込む側で値が要るか）
 * 2. high リスク
 * 3. 社内ホスト名などを含む
 * 4. medium
 * 5. low
 */
export function attentionOf(row: Row): Attention {
  return publishAttention({ hasMasked: row.hasMasked, risk: row.risk.level, hints: hintCount(row) });
}

/**
 * もらう側の順。自分に足りないもの・作者が理由を書いているものを先に出す。
 * 同じ設定をすでに持っている項目は出さない（rank 9）。
 */
export function pickAttentionOf(row: Row): Attention {
  return pickAttention({ ...(row.mine ? { mine: row.mine } : {}), ...(row.authorWhy ? { why: row.authorWhy } : {}) });
}

export function attentionFor(purpose: Purpose, row: Row): Attention {
  return purpose === "pick" ? pickAttentionOf(row) : attentionOf(row);
}

/** 注意の順に並べる（同じ順位の中では settings.json に書かれた順） */
export function attentionOrder(rows: Row[], purpose: Purpose = "publish"): Row[] {
  return rows
    .map((r, i) => ({ r, i, a: attentionFor(purpose, r).rank }))
    .sort((x, y) => x.a - y.a || x.i - y.i)
    .map((x) => x.r);
}

export interface TimelineState {
  /** 決めた順（log の順） */
  done: { row: Row; decision: Decision }[];
  /** いま見ている項目。すべて決め終えたら undefined */
  current: Row | undefined;
  /** これから出る項目（あとで回しを除く） */
  upcoming: Row[];
  /** あとで回しにした未決の項目。upcoming が尽きたら順に current になる */
  deferred: Row[];
  /** 同じ設定をすでに持っているので出さない項目（もらう側のみ） */
  already: Row[];
  total: number;
}

/**
 * タイムラインの状態を組み立てる。
 * @param log 決めた順の項目キー（選択／除外のどちらかに入っているもの）
 * @param deferred あとで回しにした順の項目キー
 */
export function timelineState(
  rows: Row[],
  selected: Set<string>,
  rejected: Set<string>,
  log: string[],
  deferred: string[],
  purpose: Purpose = "publish",
): TimelineState {
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const decision = (k: string): Decision | undefined => (selected.has(k) ? "in" : rejected.has(k) ? "out" : undefined);
  const logged = log.filter((k, i) => byKey.has(k) && decision(k) && log.indexOf(k) === i);
  // 一覧で決めた項目など、log にないものも「済み」に含める
  const extra = rows.filter((r) => decision(r.key) && !logged.includes(r.key)).map((r) => r.key);
  const doneKeys = [...extra, ...logged];
  const done = doneKeys.map((k) => ({ row: byKey.get(k)!, decision: decision(k)! }));
  const isAlready = (r: Row) => purpose === "pick" && r.mine?.kind === "same";
  const already = rows.filter((r) => isAlready(r) && !decision(r.key));
  const pending = attentionOrder(rows, purpose).filter((r) => !decision(r.key) && !isAlready(r));
  const deferredSet = new Set(deferred);
  const fresh = pending.filter((r) => !deferredSet.has(r.key));
  const later = deferred.flatMap((k) => {
    const r = byKey.get(k);
    return r && !decision(k) ? [r] : [];
  });
  const queue = [...fresh, ...later];
  return {
    done,
    current: queue[0],
    upcoming: fresh.slice(1),
    deferred: fresh.length > 0 ? later : later.slice(1),
    already,
    total: rows.length - already.length,
  };
}
