import type { Item, JsonValue, RiskLevel } from "@ccpick/core";

export interface Style {
  bold(s: string): string;
  dim(s: string): string;
  red(s: string): string;
  yellow(s: string): string;
  green(s: string): string;
  cyan(s: string): string;
}

const wrap = (code: number, reset: number) => (s: string) => `\x1b[${code}m${s}\x1b[${reset}m`;

export function makeStyle(color: boolean): Style {
  if (!color) {
    const id = (s: string) => s;
    return { bold: id, dim: id, red: id, yellow: id, green: id, cyan: id };
  }
  return {
    bold: wrap(1, 22),
    dim: wrap(2, 22),
    red: wrap(31, 39),
    yellow: wrap(33, 39),
    green: wrap(32, 39),
    cyan: wrap(36, 39),
  };
}

export function riskBadge(level: RiskLevel, s: Style): string {
  switch (level) {
    case "high":
      return s.bold(s.red("[HIGH]  "));
    case "medium":
      return s.yellow("[medium]");
    case "low":
      return s.dim("[low]   ");
  }
}

export function short(v: JsonValue | undefined, max = 80): string {
  if (v === undefined) return "(なし)";
  const t = JSON.stringify(v);
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export function pretty(v: JsonValue | undefined): string {
  return v === undefined ? "(なし)" : JSON.stringify(v, null, 2);
}

export function indent(text: string, pad = "    "): string {
  return text
    .split("\n")
    .map((l) => pad + l)
    .join("\n");
}

/** 一覧表示用の 1 行 */
export function itemLine(item: Item): string {
  if (item.kind === "array-element" || item.kind === "hook") return item.id;
  return `${item.id} = ${short(item.value)}`;
}
