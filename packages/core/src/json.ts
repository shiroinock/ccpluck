export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

/** settings.json のトップレベル。未知のキーも保持する。 */
export type Settings = JsonObject;

export function isPlainObject(v: unknown): v is JsonObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

/** キー順を無視した構造的な等価判定。 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => deepEqual(x, b[i]));
  }
  if (Array.isArray(b)) return false;
  if (typeof a === "object") {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const ak = Object.keys(ao);
    const bk = Object.keys(bo);
    if (ak.length !== bk.length) return false;
    return ak.every((k) => Object.prototype.hasOwnProperty.call(bo, k) && deepEqual(ao[k], bo[k]));
  }
  return false;
}

export function clone<T extends JsonValue | undefined>(v: T): T {
  return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T);
}

/** キーをソートした安定な JSON 文字列。同一性キーなどに使う。 */
export function canonicalJson(v: JsonValue): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (isPlainObject(v)) {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k] as JsonValue)}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

/**
 * 空のオブジェクト・空配列を再帰的に取り除く。
 * 「意味的に同じ」かを比べる前の正規化に使う（項目分解では空コンテナは項目にならないため）。
 */
export function pruneEmpty(v: JsonValue): JsonValue | undefined {
  if (Array.isArray(v)) {
    return v.length === 0 ? undefined : v.map((x) => pruneEmpty(x) ?? x);
  }
  if (isPlainObject(v)) {
    const out: JsonObject = Object.fromEntries(
      Object.entries(v).flatMap(([k, x]) => {
        const p = pruneEmpty(x);
        return p === undefined ? [] : [[k, p]];
      }),
    );
    return Object.keys(out).length === 0 ? undefined : out;
  }
  return v;
}

/** 値に含まれるすべての文字列を (JSON パス, 値) で列挙する。 */
export function* walkStrings(
  v: JsonValue,
  path: (string | number)[] = [],
): Generator<{ path: (string | number)[]; value: string }> {
  if (typeof v === "string") {
    yield { path, value: v };
  } else if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) yield* walkStrings(v[i] as JsonValue, [...path, i]);
  } else if (isPlainObject(v)) {
    for (const [k, x] of Object.entries(v)) yield* walkStrings(x, [...path, k]);
  }
}

/** ["hooks","PreToolUse",0,"hooks",0,"command"] → "hooks.PreToolUse[0].hooks[0].command" */
export function toDotPath(path: (string | number)[]): string {
  let out = "";
  for (const seg of path) {
    if (typeof seg === "number") out += `[${seg}]`;
    else if (/^[A-Za-z_$][\w$]*$/.test(seg)) out += out ? `.${seg}` : seg;
    else out += `[${JSON.stringify(seg)}]`;
  }
  return out;
}

export interface Warning {
  code: string;
  message: string;
  /** 関連する項目 ID または JSON パス */
  at?: string;
}
