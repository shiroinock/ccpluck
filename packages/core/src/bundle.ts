import { clone, isPlainObject, type JsonObject, type JsonValue, type Settings, type Warning } from "./json.js";
import { decompose, itemFromId, type Item } from "./items.js";
import { maskSettings, type MaskFinding, type MaskOptions } from "./mask.js";

export const BUNDLE_FORMAT = "ccpluck-bundle";
export const POST_FORMAT = "ccpluck-post";

/** 項目ごとの「なぜこう設定したか」 */
export interface NoteEntry {
  why?: string;
  tags?: string[];
}

/** 項目 ID → 注釈 */
export type Notes = Record<string, NoteEntry>;

export interface NotesFile {
  version: 1;
  notes: Notes;
}

export interface BundleItem {
  id: string;
  value: JsonValue;
  /** hook グループの matcher / hooks 以外のキー */
  groupExtra?: JsonObject;
}

/** Web で選んだ項目を CLI に渡すための import バンドル */
export interface ImportBundle {
  format: typeof BUNDLE_FORMAT;
  version: 1;
  createdAt?: string;
  source?: { title?: string; url?: string; author?: string };
  items: BundleItem[];
  notes?: Notes;
}

export interface PostMeta {
  title?: string;
  os?: "macos" | "linux" | "windows" | "wsl" | "other";
  /** 主な用途タグ（例: "web", "python", "safety"） */
  tags?: string[];
  /** 既定は CC0-1.0（README の仮決め参照） */
  license?: string;
}

/** 投稿 1 件 = マスク済み settings + 注釈 + メタ情報 */
export interface SharePost {
  format: typeof POST_FORMAT;
  version: 1;
  settings: Settings;
  notes: Notes;
  meta: PostMeta;
}

export const DEFAULT_LICENSE = "CC0-1.0";

export function createBundle(
  items: Item[],
  opts: { notes?: Notes; source?: ImportBundle["source"]; createdAt?: string } = {},
): ImportBundle {
  const bundle: ImportBundle = {
    format: BUNDLE_FORMAT,
    version: 1,
    items: items.map((i) => {
      const b: BundleItem = { id: i.id, value: clone(i.value) };
      if (i.hook?.groupExtra) b.groupExtra = clone(i.hook.groupExtra);
      return b;
    }),
  };
  if (opts.createdAt) bundle.createdAt = opts.createdAt;
  if (opts.source) bundle.source = opts.source;
  if (opts.notes) {
    const ids = new Set(items.map((i) => i.id));
    const picked = Object.fromEntries(Object.entries(opts.notes).filter(([id]) => ids.has(id)));
    if (Object.keys(picked).length > 0) bundle.notes = picked;
  }
  return bundle;
}

export interface ParsedBundle {
  items: Item[];
  notes: Notes;
  source?: ImportBundle["source"];
  errors: string[];
  warnings: Warning[];
}

function parseNotes(v: unknown, warnings: Warning[]): Notes {
  if (v === undefined) return {};
  if (!isPlainObject(v)) {
    warnings.push({ code: "bad-notes", message: "notes の形式が不正なため無視しました" });
    return {};
  }
  const out: Notes = {};
  for (const [id, n] of Object.entries(v)) {
    if (!isPlainObject(n)) continue;
    const entry: NoteEntry = {};
    if (typeof n.why === "string") entry.why = n.why;
    if (Array.isArray(n.tags)) entry.tags = n.tags.filter((t): t is string => typeof t === "string");
    Object.defineProperty(out, id, { value: entry, enumerable: true, writable: true, configurable: true });
  }
  return out;
}

/**
 * import バンドル、または投稿（SharePost）を読み込んで項目の列にする。
 * 外部から来た JSON なので、ID と値の整合性をここで検証する。
 */
export function parseBundle(input: unknown): ParsedBundle {
  const res: ParsedBundle = { items: [], notes: {}, errors: [], warnings: [] };
  if (!isPlainObject(input)) {
    res.errors.push("バンドルが JSON オブジェクトではありません");
    return res;
  }
  if (input.format === POST_FORMAT) {
    if (!isPlainObject(input.settings)) {
      res.errors.push("投稿の settings がオブジェクトではありません");
      return res;
    }
    const d = decompose(input.settings);
    res.items = d.items;
    res.warnings.push(...d.warnings);
    res.notes = parseNotes(input.notes, res.warnings);
    return res;
  }
  if (input.format !== BUNDLE_FORMAT) {
    res.errors.push(`未対応の形式です: ${String(input.format)}`);
    return res;
  }
  if (input.version !== 1) {
    res.errors.push(`未対応のバージョンです: ${String(input.version)}`);
    return res;
  }
  if (!Array.isArray(input.items)) {
    res.errors.push("items が配列ではありません");
    return res;
  }
  const seen = new Set<string>();
  input.items.forEach((raw, i) => {
    if (!isPlainObject(raw) || typeof raw.id !== "string" || raw.value === undefined) {
      res.errors.push(`items[${i}] の形式が不正です`);
      return;
    }
    if (seen.has(raw.id)) {
      res.warnings.push({ code: "duplicate-item", message: "重複した項目を無視しました", at: raw.id });
      return;
    }
    try {
      const groupExtra = isPlainObject(raw.groupExtra) ? raw.groupExtra : undefined;
      res.items.push(itemFromId(raw.id, clone(raw.value), groupExtra && clone(groupExtra)));
      seen.add(raw.id);
    } catch (e) {
      res.errors.push(`items[${i}]: ${(e as Error).message}`);
    }
  });
  res.notes = parseNotes(input.notes, res.warnings);
  if (isPlainObject(input.source)) {
    const src: NonNullable<ImportBundle["source"]> = {};
    for (const k of ["title", "url", "author"] as const) {
      const v = input.source[k];
      if (typeof v === "string") src[k] = v;
    }
    res.source = src;
  }
  return res;
}

/** 注釈のうち、対象の項目が存在しないもの */
export function validateNotes(notes: Notes, items: Item[]): Warning[] {
  const ids = new Set(items.map((i) => i.id));
  return Object.keys(notes)
    .filter((id) => !ids.has(id))
    .map((id) => ({ code: "orphan-note", message: "対応する項目がない注釈です", at: id }));
}

/**
 * マスク済みの settings にまだ秘密らしい値が残っていないか確認する。
 * 投稿の直前とサーバー側の受け付け時の両方で使う想定。
 */
export function verifyMasked(settings: Settings, opts: MaskOptions = {}): MaskFinding[] {
  return maskSettings(settings, opts).findings.filter((f) => f.action === "masked");
}

export function createPost(maskedSettings: Settings, notes: Notes, meta: PostMeta, opts: MaskOptions = {}): SharePost {
  const leftovers = verifyMasked(maskedSettings, opts);
  if (leftovers.length > 0) {
    throw new Error(`マスクされていない値が残っています: ${leftovers.map((f) => f.path).join(", ")}`);
  }
  return {
    format: POST_FORMAT,
    version: 1,
    settings: clone(maskedSettings),
    notes,
    meta: { license: DEFAULT_LICENSE, ...meta },
  };
}

/**
 * マスク前後の項目を対応付ける。マスクは構造を保つので、分解した項目は同じ順序で 1 対 1 に対応する。
 * マスクで 2 つの項目が同じになった（重複としてまとめられた）場合だけ、ID が一致するものに限って対応させる。
 */
export function maskedItemPairs(original: Settings, masked: Settings): { original: Item; masked: Item | undefined }[] {
  const before = decompose(original).items;
  const after = decompose(masked).items;
  if (before.length === after.length) return before.map((b, i) => ({ original: b, masked: after[i] }));
  const byId = new Map(after.map((a) => [a.id, a]));
  return before.map((b) => ({ original: b, masked: byId.get(b.id) }));
}

/** 元の settings の項目 ID で書かれた注釈を、マスク後の項目 ID に付け替える */
export function remapNotes(original: Settings, masked: Settings, notes: Notes): Notes {
  const map = new Map(maskedItemPairs(original, masked).flatMap((p) => (p.masked ? [[p.original.id, p.masked.id]] : [])));
  return Object.fromEntries(Object.entries(notes).flatMap(([id, n]) => (map.has(id) ? [[map.get(id)!, n]] : [])));
}
