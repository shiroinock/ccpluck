import { encodeItemId, parseItemId, ItemIdError, type IdSegment } from "./item-id.js";
import {
  canonicalJson,
  clone,
  deepEqual,
  isPlainObject,
  isStringArray,
  type JsonObject,
  type JsonValue,
  type Settings,
  type Warning,
} from "./json.js";
import { PERMISSIONS_KEYS, TOP_LEVEL_KEYS } from "./schema-snapshot.js";

/**
 * 項目の種類。
 * - scalar:        スキーマにあるキーの文字列・数値・真偽値など（/model, /permissions/defaultMode）
 * - whole:         スキーマにあるキーで、中身を分解せず丸ごと扱うもの（/statusLine）
 * - other:         スキーマにない未知のキー。丸ごと 1 項目
 * - array-element: 集合として扱う文字列配列の 1 要素（/permissions/allow/{"..."}）
 * - map-entry:     env などのキー単位の項目（/env/FOO）
 * - hook:          hooks.<Event>[matcher].hooks[] の 1 件
 */
export type ItemKind = "scalar" | "whole" | "other" | "array-element" | "map-entry" | "hook";

export interface HookInfo {
  event: string;
  /** undefined = グループに matcher キーがない */
  matcher?: string;
  /** グループ側の matcher / hooks 以外のキー（あれば） */
  groupExtra?: JsonObject;
}

export interface Item {
  id: string;
  kind: ItemKind;
  /**
   * 値の位置。
   * scalar/whole/other/map-entry: 値そのもののパス（["permissions","defaultMode"]）
   * array-element: 配列のパス（["permissions","allow"]）
   * hook: ["hooks", event]
   */
  path: string[];
  value: JsonValue;
  hook?: HookInfo;
}

/** permissions 配下で集合（和集合マージ）として扱う文字列配列 */
export const PERMISSION_SET_KEYS = new Set(["allow", "deny", "ask", "additionalDirectories"]);

/** トップレベルで集合として扱う文字列配列。並び順に意味がないものに限る。 */
export const TOP_LEVEL_SET_KEYS = new Set([
  "enabledMcpjsonServers",
  "disabledMcpjsonServers",
  "claudeMdExcludes",
  "skippedMarketplaces",
  "skippedPlugins",
  "httpHookAllowedEnvVars",
  "allowedHttpHookUrls",
]);

/** キー単位に分解するオブジェクト */
export const MAP_KEYS = new Set([
  "env",
  "enabledPlugins",
  "extraKnownMarketplaces",
  "pluginConfigs",
  "skillOverrides",
  "modelOverrides",
]);

// ---------------------------------------------------------------------------
// ロケーター（項目 ID が指す場所）

export type Locator =
  | { type: "value"; path: string[] }
  | { type: "elem"; path: string[]; value: string }
  | { type: "hook"; event: string; matcher?: string; identity: HookIdentity };

export interface HookIdentity {
  field: string;
  value: string;
}

/** プロトタイプ汚染を防ぐため、項目のパスに使わせないキー */
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export function locate(id: string): Locator {
  const segs = parseItemId(id);
  for (const s of segs) {
    if (s.kind === "key" && FORBIDDEN_KEYS.has(s.key)) throw new ItemIdError(id, `forbidden key ${s.key}`);
  }
  const keys: string[] = [];
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i] as IdSegment;
    if (s.kind === "key") {
      keys.push(s.key);
      continue;
    }
    if (s.kind === "elem" && i === segs.length - 1 && keys.length > 0) {
      return { type: "elem", path: keys, value: s.value };
    }
    if (
      s.kind === "match" &&
      keys.length === 2 &&
      keys[0] === "hooks" &&
      i === 2 &&
      segs.length === 4
    ) {
      const idSeg = segs[3] as IdSegment;
      if (idSeg.kind !== "match" || idSeg.field === undefined || idSeg.value === undefined) break;
      if (s.field !== undefined && s.field !== "matcher") break;
      return {
        type: "hook",
        event: keys[1] as string,
        ...(s.field === "matcher" ? { matcher: s.value as string } : {}),
        identity: { field: idSeg.field, value: idSeg.value },
      };
    }
    break;
  }
  if (keys.length !== segs.length) throw new ItemIdError(id, "unsupported segment layout");
  return { type: "value", path: keys };
}

export function hookIdentity(hook: JsonValue): HookIdentity {
  if (isPlainObject(hook)) {
    for (const field of ["command", "prompt", "url"]) {
      const v = hook[field];
      if (typeof v === "string") return { field, value: v };
    }
  }
  return { field: "hook", value: canonicalJson(hook) };
}

export function idForValue(path: string[]): string {
  return encodeItemId(path.map((key) => ({ kind: "key", key })));
}

export function idForElem(path: string[], value: string): string {
  return encodeItemId([...path.map((key) => ({ kind: "key" as const, key })), { kind: "elem", value }]);
}

export function idForHook(event: string, matcher: string | undefined, hook: JsonValue): string {
  const ident = hookIdentity(hook);
  return encodeItemId([
    { kind: "key", key: "hooks" },
    { kind: "key", key: event },
    matcher === undefined ? { kind: "match" } : { kind: "match", field: "matcher", value: matcher },
    { kind: "match", field: ident.field, value: ident.value },
  ]);
}

function classifyValue(path: string[], value: JsonValue): ItemKind {
  const primitive = value === null || typeof value !== "object";
  if (path.length === 1) {
    if (!Object.hasOwn(TOP_LEVEL_KEYS, path[0] as string)) return "other";
    return primitive ? "scalar" : "whole";
  }
  const [top, sub] = path as [string, string];
  if (top === "permissions" && path.length === 2) {
    if (!Object.hasOwn(PERMISSIONS_KEYS, sub)) return "other";
    return primitive ? "scalar" : "whole";
  }
  if (MAP_KEYS.has(top) && path.length === 2) return "map-entry";
  return "whole";
}

/**
 * ID と値から Item を組み立てる。バンドルの読み込みなど外部入力に使う。
 * ID と値が食い違う場合（配列要素・hook の同一性）は例外。
 */
export function itemFromId(id: string, value: JsonValue, groupExtra?: JsonObject): Item {
  const loc = locate(id);
  switch (loc.type) {
    case "value":
      return { id, kind: classifyValue(loc.path, value), path: loc.path, value };
    case "elem":
      if (value !== loc.value) throw new ItemIdError(id, "value does not match id");
      return { id, kind: "array-element", path: loc.path, value };
    case "hook": {
      if (!isPlainObject(value)) throw new ItemIdError(id, "hook value must be an object");
      const ident = hookIdentity(value);
      if (ident.field !== loc.identity.field || ident.value !== loc.identity.value) {
        throw new ItemIdError(id, "hook value does not match id");
      }
      const hook: HookInfo = { event: loc.event };
      if (loc.matcher !== undefined) hook.matcher = loc.matcher;
      if (groupExtra && Object.keys(groupExtra).length > 0) hook.groupExtra = groupExtra;
      return { id, kind: "hook", path: ["hooks", loc.event], value, hook };
    }
  }
}

// ---------------------------------------------------------------------------
// 分解

export interface DecomposeResult {
  items: Item[];
  warnings: Warning[];
}

function isWellFormedHookEvent(groups: JsonValue): groups is JsonObject[] {
  return (
    Array.isArray(groups) &&
    groups.every(
      (g) =>
        isPlainObject(g) &&
        (g.matcher === undefined || typeof g.matcher === "string") &&
        Array.isArray(g.hooks) &&
        g.hooks.every(isPlainObject),
    )
  );
}

export function decompose(settings: Settings): DecomposeResult {
  const items: Item[] = [];
  const warnings: Warning[] = [];
  const seen = new Set<string>();

  const push = (item: Item) => {
    try {
      locate(item.id);
    } catch {
      warnings.push({ code: "forbidden-key", message: "扱えないキーを含む項目を除外しました", at: item.id });
      return;
    }
    if (seen.has(item.id)) {
      warnings.push({ code: "duplicate-item", message: "重複した項目を 1 つにまとめました", at: item.id });
      return;
    }
    seen.add(item.id);
    items.push(item);
  };
  const pushValue = (path: string[], value: JsonValue) =>
    push({ id: idForValue(path), kind: classifyValue(path, value), path, value: clone(value) });
  const pushElems = (path: string[], values: string[]) => {
    for (const v of values) push({ id: idForElem(path, v), kind: "array-element", path, value: v });
  };

  if (!isPlainObject(settings)) {
    return { items, warnings: [{ code: "not-object", message: "settings がオブジェクトではありません" }] };
  }

  for (const [key, value] of Object.entries(settings)) {
    if (key === "permissions" && isPlainObject(value)) {
      for (const [pk, pv] of Object.entries(value)) {
        if (PERMISSION_SET_KEYS.has(pk) && isStringArray(pv)) pushElems(["permissions", pk], pv);
        else pushValue(["permissions", pk], pv);
      }
    } else if (MAP_KEYS.has(key) && isPlainObject(value)) {
      for (const [mk, mv] of Object.entries(value)) pushValue([key, mk], mv);
    } else if (key === "hooks" && isPlainObject(value)) {
      for (const [event, groups] of Object.entries(value)) {
        if (!isWellFormedHookEvent(groups)) {
          warnings.push({
            code: "malformed-hooks",
            message: `hooks.${event} の形式が想定と違うため丸ごと 1 項目として扱います`,
            at: idForValue(["hooks", event]),
          });
          pushValue(["hooks", event], groups);
          continue;
        }
        for (const group of groups) {
          const matcher = group.matcher as string | undefined;
          const groupExtra: JsonObject = {};
          for (const [gk, gv] of Object.entries(group)) {
            if (gk !== "matcher" && gk !== "hooks" && !FORBIDDEN_KEYS.has(gk)) groupExtra[gk] = clone(gv);
          }
          for (const hook of group.hooks as JsonObject[]) {
            const info: HookInfo = { event };
            if (matcher !== undefined) info.matcher = matcher;
            if (Object.keys(groupExtra).length > 0) info.groupExtra = groupExtra;
            push({
              id: idForHook(event, matcher, hook),
              kind: "hook",
              path: ["hooks", event],
              value: clone(hook),
              hook: info,
            });
          }
        }
      }
    } else if (TOP_LEVEL_SET_KEYS.has(key) && isStringArray(value)) {
      pushElems([key], value);
    } else {
      pushValue([key], value);
    }
  }
  return { items, warnings };
}

// ---------------------------------------------------------------------------
// 読み書き

export class TargetError extends Error {
  constructor(
    public readonly itemId: string,
    reason: string,
  ) {
    super(`cannot apply ${itemId}: ${reason}`);
    this.name = "TargetError";
  }
}

function walkObject(root: JsonObject, path: string[]): JsonValue | undefined {
  let cur: JsonValue | undefined = root;
  for (const k of path) {
    if (!isPlainObject(cur)) return undefined;
    cur = cur[k];
  }
  return cur;
}

function ensureObject(root: JsonObject, path: string[], id: string): JsonObject {
  let cur: JsonObject = root;
  for (const k of path) {
    const next: JsonValue | undefined = cur[k];
    if (next === undefined) {
      const created: JsonObject = {};
      cur[k] = created;
      cur = created;
    } else if (isPlainObject(next)) {
      cur = next;
    } else {
      throw new TargetError(id, `${path.join(".")} がオブジェクトではありません`);
    }
  }
  return cur;
}

function findGroup(groups: JsonValue[], matcher: string | undefined): JsonObject | undefined {
  return groups.find(
    (g): g is JsonObject =>
      isPlainObject(g) && (g.matcher as string | undefined) === matcher && Array.isArray(g.hooks),
  );
}

/** 項目 ID が指す現在の値。存在しなければ undefined。 */
export function getItemValue(settings: Settings, id: string): JsonValue | undefined {
  const loc = locate(id);
  switch (loc.type) {
    case "value":
      return walkObject(settings, loc.path);
    case "elem": {
      const arr = walkObject(settings, loc.path);
      return Array.isArray(arr) && arr.includes(loc.value) ? loc.value : undefined;
    }
    case "hook": {
      const groups = walkObject(settings, ["hooks", loc.event]);
      if (!Array.isArray(groups)) return undefined;
      for (const g of groups) {
        if (!isPlainObject(g) || (g.matcher as string | undefined) !== loc.matcher) continue;
        if (!Array.isArray(g.hooks)) continue;
        for (const h of g.hooks) {
          const ident = hookIdentity(h);
          if (ident.field === loc.identity.field && ident.value === loc.identity.value) return h;
        }
      }
      return undefined;
    }
  }
}

/** settings を直接書き換えて項目を追加・置換する（内部用）。 */
export function upsertInPlace(settings: Settings, item: Item): void {
  const loc = locate(item.id);
  switch (loc.type) {
    case "value": {
      const parent = ensureObject(settings, loc.path.slice(0, -1), item.id);
      parent[loc.path[loc.path.length - 1] as string] = clone(item.value);
      return;
    }
    case "elem": {
      const parent = ensureObject(settings, loc.path.slice(0, -1), item.id);
      const key = loc.path[loc.path.length - 1] as string;
      const arr = parent[key];
      if (arr === undefined) parent[key] = [loc.value];
      else if (Array.isArray(arr)) {
        if (!arr.includes(loc.value)) arr.push(loc.value);
      } else throw new TargetError(item.id, `${loc.path.join(".")} が配列ではありません`);
      return;
    }
    case "hook": {
      const hooks = ensureObject(settings, ["hooks"], item.id);
      let groups = hooks[loc.event];
      if (groups === undefined) {
        groups = [];
        hooks[loc.event] = groups;
      }
      if (!Array.isArray(groups)) throw new TargetError(item.id, `hooks.${loc.event} が配列ではありません`);
      let group = findGroup(groups, loc.matcher);
      if (!group) {
        group = {};
        if (loc.matcher !== undefined) group.matcher = loc.matcher;
        for (const [gk, gv] of Object.entries(item.hook?.groupExtra ?? {})) {
          if (gk !== "matcher" && gk !== "hooks" && !FORBIDDEN_KEYS.has(gk)) group[gk] = clone(gv);
        }
        group.hooks = [];
        groups.push(group);
      }
      const list = group.hooks as JsonValue[];
      const idx = list.findIndex((h) => {
        const ident = hookIdentity(h);
        return ident.field === loc.identity.field && ident.value === loc.identity.value;
      });
      if (idx >= 0) list[idx] = clone(item.value);
      else list.push(clone(item.value));
      return;
    }
  }
}

/** 空になったコンテナを path に沿って取り除く */
function pruneAlong(root: JsonObject, path: string[]): void {
  for (let depth = path.length; depth >= 1; depth--) {
    const parent = walkObject(root, path.slice(0, depth - 1));
    const key = path[depth - 1] as string;
    if (!isPlainObject(parent)) return;
    const v = parent[key];
    const empty = (Array.isArray(v) && v.length === 0) || (isPlainObject(v) && Object.keys(v).length === 0);
    if (!empty) return;
    delete parent[key];
  }
}

/** settings を直接書き換えて項目を取り除く（内部用）。存在しなければ何もしない。 */
export function removeInPlace(settings: Settings, id: string): void {
  const loc = locate(id);
  switch (loc.type) {
    case "value": {
      const parent = walkObject(settings, loc.path.slice(0, -1));
      if (isPlainObject(parent)) delete parent[loc.path[loc.path.length - 1] as string];
      pruneAlong(settings, loc.path.slice(0, -1));
      return;
    }
    case "elem": {
      const arr = walkObject(settings, loc.path);
      if (!Array.isArray(arr)) return;
      for (let i = arr.length - 1; i >= 0; i--) if (arr[i] === loc.value) arr.splice(i, 1);
      pruneAlong(settings, loc.path);
      return;
    }
    case "hook": {
      const groups = walkObject(settings, ["hooks", loc.event]);
      if (!Array.isArray(groups)) return;
      for (let gi = groups.length - 1; gi >= 0; gi--) {
        const g = groups[gi];
        if (!isPlainObject(g) || (g.matcher as string | undefined) !== loc.matcher) continue;
        if (!Array.isArray(g.hooks)) continue;
        g.hooks = g.hooks.filter((h) => {
          const ident = hookIdentity(h);
          return !(ident.field === loc.identity.field && ident.value === loc.identity.value);
        });
        if (g.hooks.length === 0) groups.splice(gi, 1);
      }
      pruneAlong(settings, ["hooks", loc.event]);
      return;
    }
  }
}

/** 項目を追加・置換した新しい settings を返す（引数は変更しない）。 */
export function upsertItem(settings: Settings, item: Item): Settings {
  const out = clone(settings);
  upsertInPlace(out, item);
  return out;
}

/** 項目を取り除いた新しい settings を返す（引数は変更しない）。 */
export function removeItem(settings: Settings, id: string): Settings {
  const out = clone(settings);
  removeInPlace(out, id);
  return out;
}

/** 項目の列から settings を組み立てる（decompose の逆）。 */
export function compose(items: Item[]): Settings {
  const out: Settings = {};
  for (const item of items) upsertInPlace(out, item);
  return out;
}

/** 項目が settings に「同じ値で」入っているか */
export function hasItem(settings: Settings, item: Item): boolean {
  return deepEqual(getItemValue(settings, item.id), item.value);
}

/** スキーマの description（なければ undefined） */
export function describeItem(item: Item): string | undefined {
  const [top, sub] = item.path;
  if (top === "permissions" && sub !== undefined) {
    return Object.hasOwn(PERMISSIONS_KEYS, sub) ? PERMISSIONS_KEYS[sub]?.description : undefined;
  }
  return top !== undefined && Object.hasOwn(TOP_LEVEL_KEYS, top) ? TOP_LEVEL_KEYS[top]?.description : undefined;
}

/**
 * 値を差し替えた項目を返す。配列要素や hook のように ID が値から決まる項目は ID も作り直す。
 * 取り込み時にマスク値を埋めたときなどに使う。
 */
export function withValue(item: Item, value: JsonValue): Item {
  switch (item.kind) {
    case "array-element":
      return itemFromId(idForElem(item.path, value as string), value);
    case "hook":
      return itemFromId(
        idForHook(item.hook?.event ?? (item.path[1] as string), item.hook?.matcher, value),
        value,
        item.hook?.groupExtra,
      );
    default:
      return { ...item, value };
  }
}
