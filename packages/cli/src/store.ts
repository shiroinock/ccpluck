import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ImportBundle, JournalOp } from "@ccpluck/core";
import { CliError } from "./context.js";
import { atomicWrite } from "./fsutil.js";

/**
 * 取り込み 1 回分の記録。~/.ccpluck/imports/<id>.json に保存する。
 * 適用前のファイル全体（beforeText）と、項目ごとのジャーナル（ops）を持つ。
 */
export interface ImportRecord {
  version: 1;
  id: string;
  createdAt: string;
  settingsPath: string;
  source: {
    input: string;
    title?: string;
    url?: string;
    author?: string;
    /** 置き場所の投稿（`team:kenta/python`） */
    post?: string;
    /** 投稿の版（GitHub ではコミット ID） */
    version?: string;
  };
  /** 適用前のファイルの中身。ファイルがなかった場合は null */
  beforeText: string | null;
  /** 適用直後のファイルの sha256。undo でバイト一致の復元ができるかの判定に使う */
  afterSha256: string;
  ops: JournalOp[];
  /** revert 済みの項目 ID */
  reverted: string[];
  status: "applied" | "undone";
  undoneAt?: string;
}

export class Store {
  constructor(public readonly dataDir: string) {}

  private get dir() {
    return join(this.dataDir, "imports");
  }

  newId(now: Date): string {
    const ts = now.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
    return `${ts}-${randomBytes(2).toString("hex")}`;
  }

  async save(rec: ImportRecord): Promise<void> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    await atomicWrite(join(this.dir, `${rec.id}.json`), `${JSON.stringify(rec, null, 2)}\n`);
  }

  async remove(id: string): Promise<void> {
    await atomicWrite(join(this.dir, `${id}.json`), null);
  }

  async load(id: string): Promise<ImportRecord> {
    if (!/^[\w-]+$/.test(id)) throw new CliError(`不正な importId です: ${id}`);
    try {
      return JSON.parse(await readFile(join(this.dir, `${id}.json`), "utf8")) as ImportRecord;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") throw new CliError(`取り込み履歴が見つかりません: ${id}`);
      throw e;
    }
  }

  /** 新しい順 */
  async list(): Promise<ImportRecord[]> {
    let files: string[];
    try {
      files = await readdir(this.dir);
    } catch {
      return [];
    }
    const recs = await Promise.all(
      files.filter((f) => f.endsWith(".json")).map((f) => this.load(f.slice(0, -5))),
    );
    return recs.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : b.id.localeCompare(a.id)));
  }
}

export type { ImportBundle };
