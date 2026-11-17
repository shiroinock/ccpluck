import { createHash } from "node:crypto";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { JsonValue, PickDecision } from "@ccpluck/core";
import { atomicWrite } from "./fsutil.js";

/**
 * 同じ投稿を前に pick したときの決定。~/.ccpluck/picks/<投稿の参照のハッシュ>.json に保存する。
 * 2 回目以降の pick で、前回決めた項目（値が変わっていないもの）をもう一度聞かないために使う。
 */
export interface PickMemory {
  version: 1;
  /** 投稿の参照（URL や絶対パス） */
  sourceKey: string;
  title?: string;
  /** 最後に pick したときの投稿の版（置き場所の投稿のみ。updates で使う） */
  postVersion?: string;
  updatedAt: string;
  decisions: Record<string, { decision: PickDecision; valueHash: string; at: string }>;
}

/** キー順に依存しない JSON 文字列のハッシュ（投稿の書き直しでキー順が変わっても同じ値とみなす） */
export function valueHash(v: JsonValue): string {
  const canon = (x: JsonValue): JsonValue =>
    Array.isArray(x)
      ? x.map(canon)
      : x !== null && typeof x === "object"
        ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, canon(x[k] as JsonValue)]))
        : x;
  return createHash("sha256").update(JSON.stringify(canon(v)), "utf8").digest("hex").slice(0, 32);
}

export class PickMemoryStore {
  constructor(public readonly dataDir: string) {}

  private file(sourceKey: string): string {
    const h = createHash("sha256").update(sourceKey, "utf8").digest("hex").slice(0, 32);
    return join(this.dataDir, "picks", `${h}.json`);
  }

  async load(sourceKey: string): Promise<PickMemory | undefined> {
    try {
      const m = JSON.parse(await readFile(this.file(sourceKey), "utf8")) as PickMemory;
      return m.version === 1 && m.sourceKey === sourceKey ? m : undefined;
    } catch {
      return undefined;
    }
  }

  async save(m: PickMemory): Promise<void> {
    await mkdir(join(this.dataDir, "picks"), { recursive: true, mode: 0o700 });
    await atomicWrite(this.file(m.sourceKey), `${JSON.stringify(m, null, 2)}\n`);
  }

  /** 覚えているすべての投稿 */
  async list(): Promise<PickMemory[]> {
    let files: string[];
    try {
      files = await readdir(join(this.dataDir, "picks"));
    } catch {
      return [];
    }
    const out: PickMemory[] = [];
    for (const f of files.filter((x) => x.endsWith(".json"))) {
      try {
        const m = JSON.parse(await readFile(join(this.dataDir, "picks", f), "utf8")) as PickMemory;
        if (m.version === 1 && typeof m.sourceKey === "string") out.push(m);
      } catch {
        /* 壊れたファイルは飛ばす */
      }
    }
    return out;
  }
}

/**
 * 前に publish したときの決定。~/.ccpluck/publish/<書き出し先のハッシュ>.json に保存する。
 * `publish --update` で、前回決めた項目（値が変わっていないもの）をもう一度聞かないために使う。
 * 項目 ID はマスク後のもの。
 */
export interface PublishMemory {
  version: 1;
  /** 書き出した投稿ファイルの絶対パス */
  outputPath: string;
  updatedAt: string;
  publicEnv: string[];
  decisions: Record<string, { decision: PickDecision; valueHash: string; at: string }>;
  /** 書いた理由（項目 ID → 文）。レビュー待ちで公開前の投稿を出し直すときに引き継ぐ */
  whys?: Record<string, string>;
}

export class PublishMemoryStore {
  constructor(public readonly dataDir: string) {}

  private file(outputPath: string): string {
    const h = createHash("sha256").update(outputPath, "utf8").digest("hex").slice(0, 32);
    return join(this.dataDir, "publish", `${h}.json`);
  }

  async load(outputPath: string): Promise<PublishMemory | undefined> {
    try {
      const m = JSON.parse(await readFile(this.file(outputPath), "utf8")) as PublishMemory;
      return m.version === 1 && m.outputPath === outputPath ? m : undefined;
    } catch {
      return undefined;
    }
  }

  async save(m: PublishMemory): Promise<void> {
    await mkdir(join(this.dataDir, "publish"), { recursive: true, mode: 0o700 });
    await atomicWrite(this.file(m.outputPath), `${JSON.stringify(m, null, 2)}\n`);
  }
}
