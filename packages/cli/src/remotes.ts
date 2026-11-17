import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Backend } from "./backend.js";
import { CliError, type Context } from "./context.js";
import { atomicWrite } from "./fsutil.js";
import { GitHubBackend } from "./github.js";

/** 登録した置き場所。~/.ccpluck/remotes.json に保存する */
export interface RemoteConfig {
  kind: "github";
  /** owner/repo */
  repo: string;
  /** GitHub のホスト（github.com か GitHub Enterprise Server のホスト名） */
  host: string;
  /** clone に使う URL（既定は https://<host>/<repo>.git） */
  gitUrl: string;
  /** 公開済みの投稿があるブランチ */
  branch: string;
  addedAt: string;
}

interface RemotesFile {
  version: 1;
  remotes: Record<string, RemoteConfig>;
}

export const REMOTE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;

/** `github:owner/repo` を読む */
export function parseRemoteSpec(spec: string): { kind: "github"; repo: string } {
  const m = /^github:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(spec);
  if (!m) throw new CliError(`置き場所は github:<owner>/<repo> の形で指定してください: ${spec}`);
  return { kind: "github", repo: `${m[1]}/${m[2]}` };
}

export class RemoteStore {
  constructor(public readonly dataDir: string) {}

  private get file() {
    return join(this.dataDir, "remotes.json");
  }

  /** bare clone の置き場所 */
  cloneDir(name: string): string {
    return join(this.dataDir, "remotes", `${name}.git`);
  }

  async load(): Promise<RemotesFile> {
    try {
      const f = JSON.parse(await readFile(this.file, "utf8")) as RemotesFile;
      if (f.version === 1 && f.remotes && typeof f.remotes === "object") {
        return { version: 1, remotes: Object.assign(Object.create(null) as Record<string, RemoteConfig>, f.remotes) };
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw new CliError(`${this.file} を読めません: ${(e as Error).message}`);
    }
    return { version: 1, remotes: Object.create(null) as Record<string, RemoteConfig> };
  }

  async save(f: RemotesFile): Promise<void> {
    await mkdir(this.dataDir, { recursive: true, mode: 0o700 });
    await atomicWrite(this.file, `${JSON.stringify(f, null, 2)}\n`);
  }

  async get(name: string): Promise<RemoteConfig | undefined> {
    const f = await this.load();
    return Object.hasOwn(f.remotes, name) ? f.remotes[name] : undefined;
  }
}

export function openBackend(ctx: Context, dataDir: string, name: string, cfg: RemoteConfig): Backend {
  return new GitHubBackend(ctx, name, cfg, new RemoteStore(dataDir).cloneDir(name));
}

/** 登録済みの置き場所を開く。なければエラー */
export async function requireBackend(ctx: Context, dataDir: string, name: string): Promise<Backend> {
  const cfg = await new RemoteStore(dataDir).get(name);
  if (!cfg) throw new CliError(`置き場所 ${name} は登録されていません（ccpluck remote add ${name} github:<owner>/<repo>）`);
  return openBackend(ctx, dataDir, name, cfg);
}
