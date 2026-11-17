import { isPlainObject } from "./json.js";
import type { Item } from "./items.js";
import { COMMAND_KEYS } from "./risk.js";

export interface Dependency {
  itemId: string;
  /** コマンドに書かれていたままのパス */
  path: string;
  /** home: ~ や $HOME 起点 / project: $CLAUDE_PROJECT_DIR 起点 / absolute: 絶対パス */
  base: "home" | "project" | "absolute";
}

const PATH_RE =
  /(?:~|\$HOME|\$\{HOME\}|\$CLAUDE_PROJECT_DIR|\$\{CLAUDE_PROJECT_DIR\}|"\$CLAUDE_PROJECT_DIR"|(?<![\w.~$])\/)[^\s"'`;|&<>()]*/g;

/** OS 標準のコマンドなど、依存ファイルとして扱わないパス */
const SYSTEM_PREFIXES = ["/usr/", "/bin/", "/sbin/", "/opt/homebrew/", "/dev/", "/etc/", "/tmp/", "/System/", "/Library/"];

/**
 * コマンド文字列から、手元に存在する必要がありそうなファイルパスを取り出す。
 * スクリプトらしいもの（拡張子あり、または .claude 配下）だけを返す。
 */
export function extractReferencedPaths(command: string): Omit<Dependency, "itemId">[] {
  const out: Omit<Dependency, "itemId">[] = [];
  const seen = new Set<string>();
  for (const m of command.matchAll(PATH_RE)) {
    const raw = m[0].replace(/"/g, "");
    if (raw === "/" || raw === "~" || seen.has(raw)) continue;
    if (SYSTEM_PREFIXES.some((p) => raw.startsWith(p))) continue;
    const last = raw.split("/").pop() ?? "";
    const scriptLike = /\.[A-Za-z0-9]{1,5}$/.test(last) || raw.includes("/.claude/");
    if (!scriptLike) continue;
    const base = /^(~|\$HOME|\$\{HOME\})/.test(raw)
      ? "home"
      : /CLAUDE_PROJECT_DIR/.test(raw)
        ? "project"
        : "absolute";
    seen.add(raw);
    out.push({ path: raw, base });
  }
  return out;
}

/** 項目が参照しているスクリプト（hook・statusLine・apiKeyHelper など） */
export function itemDependencies(item: Item): Dependency[] {
  const commands: string[] = [];
  if (item.kind === "hook" && isPlainObject(item.value) && typeof item.value.command === "string") {
    commands.push(item.value.command);
  } else if (COMMAND_KEYS.has(item.path[0] ?? "")) {
    if (typeof item.value === "string") commands.push(item.value);
    else if (isPlainObject(item.value) && typeof item.value.command === "string") commands.push(item.value.command);
  }
  return commands.flatMap((c) => extractReferencedPaths(c).map((d) => ({ ...d, itemId: item.id })));
}
