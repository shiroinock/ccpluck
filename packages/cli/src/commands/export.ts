import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  createPost,
  isPlainObject,
  maskSettings,
  validateNotes,
  decompose,
  type MaskFinding,
  type Notes,
  type PostMeta,
  type Settings,
} from "@ccpick/core";
import { CliError, type Context } from "../context.js";
import { readSettingsFile } from "../fsutil.js";
import { makeStyle } from "../render.js";

export interface ExportOptions {
  settingsPath: string;
  mask: boolean;
  publicEnv: string[];
  notesPath?: string;
  output?: string;
  title?: string;
  os?: string;
  tags: string[];
  license?: string;
  yes: boolean;
}

function osFromPlatform(p: NodeJS.Platform): PostMeta["os"] {
  return p === "darwin" ? "macos" : p === "linux" ? "linux" : p === "win32" ? "windows" : "other";
}

async function loadNotes(path: string): Promise<Notes> {
  const raw = JSON.parse(await readFile(path, "utf8")) as unknown;
  // { version: 1, notes: {...} } と { "<itemId>": {...} } のどちらも受け付ける
  const notes = isPlainObject(raw) && isPlainObject(raw.notes) ? raw.notes : raw;
  if (!isPlainObject(notes)) throw new CliError(`${path} は注釈の形式ではありません`);
  return notes as Notes;
}

/** 手元の設定をマスクして投稿用の JSON を作る */
export async function runExport(ctx: Context, opts: ExportOptions): Promise<number> {
  const { io } = ctx;
  const s = makeStyle(io.color);
  if (!opts.mask) {
    throw new CliError("MVP では --mask が必須です（マスクせずに書き出す機能はありません）");
  }
  const file = await readSettingsFile(opts.settingsPath);
  if (file.text === null) throw new CliError(`${opts.settingsPath} がありません`);

  const { settings: masked, findings } = maskSettings(file.settings, { publicEnvKeys: opts.publicEnv });
  const notes = opts.notesPath ? await loadNotes(resolve(ctx.cwd, opts.notesPath)) : {};
  for (const w of validateNotes(notes, decompose(file.settings).items)) io.err(s.yellow(`警告: ${w.message}: ${w.at}`));

  const meta: PostMeta = { os: (opts.os as PostMeta["os"]) ?? osFromPlatform(ctx.platform), tags: opts.tags };
  if (opts.title) meta.title = opts.title;
  if (opts.license) meta.license = opts.license;
  const post = createPost(masked, remapNotes(file.settings, masked, notes), meta, { publicEnvKeys: opts.publicEnv });

  // --- 確認画面
  io.err(s.bold(`\n${opts.settingsPath} をマスクしました\n`));
  printFindings(ctx, findings);
  io.err(s.bold("\n公開される内容:"));
  io.err(highlightMarkers(JSON.stringify(post.settings, null, 2), s.cyan));
  io.err("");

  if (!opts.yes) {
    if (!io.interactive) throw new CliError("確認が必要です。内容を確認したうえで --yes を付けて実行してください");
    const a = (await io.ask("この内容で書き出しますか? [y/N] ")).trim().toLowerCase();
    if (a !== "y" && a !== "yes") {
      io.err("中止しました");
      return 1;
    }
  }

  const text = `${JSON.stringify(post, null, 2)}\n`;
  if (opts.output) {
    const out = resolve(ctx.cwd, opts.output);
    await writeFile(out, text, "utf8");
    io.err(s.green(`書き出しました: ${out}`));
  } else {
    io.out(text);
  }
  return 0;
}

/**
 * マスクでパスやコマンドが書き換わると項目 ID も変わるので、注釈のキーを付け替える。
 * マスクは構造を保つため、分解した項目は同じ順序で 1 対 1 に対応する。
 */
export function remapNotes(original: Settings, masked: Settings, notes: Notes): Notes {
  const before = decompose(original).items;
  const after = decompose(masked).items;
  if (before.length !== after.length) {
    // マスクで 2 つの項目が同じになった場合など。対応が取れないものは元の ID のまま残す
    const ids = new Set(after.map((i) => i.id));
    return Object.fromEntries(Object.entries(notes).filter(([id]) => ids.has(id)));
  }
  const map = new Map(before.map((b, i) => [b.id, after[i]!.id]));
  return Object.fromEntries(Object.entries(notes).flatMap(([id, n]) => (map.has(id) ? [[map.get(id)!, n]] : [])));
}

function highlightMarkers(text: string, paint: (s: string) => string): string {
  return text.replace(/<<MASKED:[^<>]+>>/g, (m) => paint(m));
}

function printFindings(ctx: Context, findings: MaskFinding[]): void {
  const s = makeStyle(ctx.io.color);
  const groups: [string, MaskFinding[]][] = [
    ["マスクした値", findings.filter((f) => f.action === "masked")],
    ["置き換えたパス", findings.filter((f) => f.action === "replaced")],
    ["確認してほしい箇所（変更なし）", findings.filter((f) => f.action === "highlight")],
  ];
  for (const [title, list] of groups) {
    if (list.length === 0) continue;
    ctx.io.err(s.bold(`${title} (${list.length})`));
    for (const f of list) {
      const extra = f.match ? `: ${s.yellow(f.match)}` : "";
      ctx.io.err(`  ${f.path}  ${s.dim(f.reason)}${extra}`);
    }
  }
  if (findings.some((f) => f.kind === "env")) {
    ctx.io.err(s.dim("  env の値は既定で非公開です。公開してよいキーは --public-env KEY,KEY で指定できます"));
  }
}
