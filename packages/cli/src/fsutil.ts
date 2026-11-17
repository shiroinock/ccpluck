import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, basename } from "node:path";
import { validateSettings, type Settings } from "@ccpick/core";
import { CliError } from "./context.js";

export interface SettingsFile {
  path: string;
  /** ファイルの中身そのもの。存在しなければ null */
  text: string | null;
  settings: Settings;
  format: JsonFormat;
}

export interface JsonFormat {
  indent: string | number;
  trailingNewline: boolean;
}

export const DEFAULT_FORMAT: JsonFormat = { indent: 2, trailingNewline: true };

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** 既存ファイルのインデントと末尾改行を推定する（書き戻しで差分を最小にするため） */
export function detectFormat(text: string): JsonFormat {
  const m = /^\{\r?\n([ \t]+)\S/m.exec(text);
  const indent = m?.[1] ? (m[1].includes("\t") ? "\t" : m[1].length) : 2;
  return { indent, trailingNewline: text.endsWith("\n") };
}

export function formatJson(value: unknown, format: JsonFormat = DEFAULT_FORMAT): string {
  return JSON.stringify(value, null, format.indent) + (format.trailingNewline ? "\n" : "");
}

export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function readSettingsFile(path: string): Promise<SettingsFile> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return { path, text: null, settings: {}, format: DEFAULT_FORMAT };
    }
    throw e;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new CliError(`${path} を JSON として読めません: ${(e as Error).message}`);
  }
  const v = validateSettings(parsed);
  if (!v.ok) throw new CliError(`${path} の形式が不正です:\n  ${v.errors.join("\n  ")}`);
  return { path, text, settings: parsed as Settings, format: detectFormat(text) };
}

/**
 * 一時ファイルに書いてから rename する（アトミック書き込み）。
 * text が null ならファイルを消す（取り込み前にファイルがなかった場合の undo）。
 */
export async function atomicWrite(path: string, text: string | null): Promise<void> {
  if (text === null) {
    await rm(path, { force: true });
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  const tmp = join(dirname(path), `.${basename(path)}.${randomBytes(6).toString("hex")}.tmp`);
  // 既存ファイルのパーミッションを引き継ぐ（新規は 0600）
  let mode = 0o600;
  try {
    mode = (await stat(path)).mode & 0o777;
  } catch {
    // 新規作成
  }
  try {
    await writeFile(tmp, text, { encoding: "utf8", mode });
    await rename(tmp, path);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}

/** settings を検証してから書き込む。書いた文字列を返す */
export async function writeSettings(path: string, settings: Settings, format: JsonFormat): Promise<string> {
  const text = formatJson(settings, format);
  // 書き込む文字列そのものをパースし直して検証する
  const v = validateSettings(JSON.parse(text));
  if (!v.ok) throw new CliError(`書き込もうとした settings が不正です:\n  ${v.errors.join("\n  ")}`);
  await atomicWrite(path, text);
  return text;
}
