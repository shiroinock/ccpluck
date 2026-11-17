/**
 * 項目 ID のエンコードとパース。
 *
 * 形式: "/" 区切りのセグメント列。
 * - キーセグメント: JSON Pointer と同じエスケープ（"~" → "~0", "/" → "~1"）。
 *   先頭が "{" のキーは "~2" で始めて値セグメントと区別する。
 * - 値セグメント: `{"<JSON 文字列>"}` — 文字列配列の要素（例: `{"Bash(npm run test *)"}`）
 * - 一致セグメント: `{name:"<JSON 文字列>"}` — hook の matcher / command など。
 *   matcher を持たない hook グループは `{}`。
 *
 * 例:
 *   /model
 *   /permissions/allow/{"Bash(npm run test *)"}
 *   /env/FOO
 *   /hooks/PreToolUse/{matcher:"Bash"}/{command:"~/.claude/hooks/guard.sh"}
 */

export type IdSegment =
  | { kind: "key"; key: string }
  | { kind: "elem"; value: string }
  | { kind: "match"; field?: string; value?: string };

export function encodeKey(key: string): string {
  const esc = key.replace(/~/g, "~0").replace(/\//g, "~1");
  return esc.startsWith("{") ? `~2${esc.slice(1)}` : esc;
}

function decodeKey(seg: string): string {
  const s = seg.startsWith("~2") ? `{${seg.slice(2)}` : seg;
  return s.replace(/~1/g, "/").replace(/~0/g, "~");
}

export function encodeSegment(seg: IdSegment): string {
  switch (seg.kind) {
    case "key":
      return encodeKey(seg.key);
    case "elem":
      return `{${JSON.stringify(seg.value)}}`;
    case "match":
      if (seg.field === undefined) return "{}";
      return `{${seg.field}:${JSON.stringify(seg.value ?? "")}}`;
  }
}

export function encodeItemId(segments: IdSegment[]): string {
  return segments.map((s) => `/${encodeSegment(s)}`).join("");
}

export class ItemIdError extends Error {
  constructor(id: string, reason: string) {
    super(`invalid item id ${JSON.stringify(id)}: ${reason}`);
    this.name = "ItemIdError";
  }
}

/** JSON 文字列リテラルを読み、[値, 終了位置] を返す。 */
function readJsonString(src: string, start: number, id: string): [string, number] {
  if (src[start] !== '"') throw new ItemIdError(id, `expected '"' at ${start}`);
  let i = start + 1;
  while (i < src.length) {
    const c = src[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === '"') {
      const lit = src.slice(start, i + 1);
      try {
        return [JSON.parse(lit) as string, i + 1];
      } catch {
        throw new ItemIdError(id, `bad string literal ${lit}`);
      }
    }
    i++;
  }
  throw new ItemIdError(id, "unterminated string");
}

export function parseItemId(id: string): IdSegment[] {
  if (!id.startsWith("/")) throw new ItemIdError(id, "must start with '/'");
  const segs: IdSegment[] = [];
  let i = 1;
  while (i <= id.length) {
    if (id[i] === "{") {
      let seg: IdSegment;
      let j: number;
      if (id[i + 1] === "}") {
        seg = { kind: "match" };
        j = i + 2;
      } else if (id[i + 1] === '"') {
        const [value, end] = readJsonString(id, i + 1, id);
        if (id[end] !== "}") throw new ItemIdError(id, `expected '}' at ${end}`);
        seg = { kind: "elem", value };
        j = end + 1;
      } else {
        const colon = id.indexOf(":", i);
        if (colon < 0) throw new ItemIdError(id, "expected ':' in match segment");
        const field = id.slice(i + 1, colon);
        if (!/^[A-Za-z_][\w-]*$/.test(field)) throw new ItemIdError(id, `bad field name ${field}`);
        const [value, end] = readJsonString(id, colon + 1, id);
        if (id[end] !== "}") throw new ItemIdError(id, `expected '}' at ${end}`);
        seg = { kind: "match", field, value };
        j = end + 1;
      }
      segs.push(seg);
      if (j === id.length) break;
      if (id[j] !== "/") throw new ItemIdError(id, `expected '/' at ${j}`);
      i = j + 1;
    } else {
      const next = id.indexOf("/", i);
      const raw = next < 0 ? id.slice(i) : id.slice(i, next);
      if (raw === "") throw new ItemIdError(id, "empty segment");
      segs.push({ kind: "key", key: decodeKey(raw) });
      if (next < 0) break;
      i = next + 1;
    }
  }
  return segs;
}
