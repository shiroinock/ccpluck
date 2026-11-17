import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Backend, Identity, PostEntry, PostWithBody, SubmitRequest, SubmitResult } from "./backend.js";
import { NAME_RE } from "./backend.js";
import { CliError, type Context } from "./context.js";
import { exists } from "./fsutil.js";
import { git } from "./git.js";
import type { RemoteConfig } from "./remotes.js";

const POST_PATH_RE = /^posts\/([^/]+)\/([^/]+)\.json$/;

export const postPath = (author: string, name: string) => `posts/${author}/${name}.json`;
export const publishBranch = (author: string, name: string) => `ccpluck/publish/${author}/${name}`;

/**
 * GitHub のリポジトリを置き場所にする実装。
 * - 手元には bare clone（~/.ccpluck/remotes/<名前>.git）を持ち、公開済みのブランチだけを追う
 * - 投稿は作業ツリーを使わずにコミットを作り、投稿ごとのブランチに push して PR を作る
 * - PR・ユーザー情報は GitHub の API を使う。トークンは GITHUB_TOKEN / GH_TOKEN か `gh auth token` から
 */
export class GitHubBackend implements Backend {
  readonly label: string;
  private token: string | null | undefined;

  constructor(
    private readonly ctx: Context,
    readonly name: string,
    private readonly cfg: RemoteConfig,
    private readonly dir: string,
  ) {
    this.label = `github:${cfg.repo}${cfg.host === "github.com" ? "" : ` (${cfg.host})`}`;
  }

  // -------------------------------------------------------------------------
  // 認証

  /** トークン。見つからなければ null */
  private getToken(): string | null {
    if (this.token !== undefined) return this.token;
    const env = this.ctx.env;
    let t = env.CCPLUCK_GITHUB_TOKEN || env.GITHUB_TOKEN || env.GH_TOKEN || null;
    if (!t) {
      const r = spawnSync("gh", ["auth", "token", "--hostname", this.cfg.host], { encoding: "utf8", env: { ...process.env, ...env } });
      if (r.status === 0 && r.stdout.trim()) t = r.stdout.trim();
    }
    this.token = t;
    return t;
  }

  private requireToken(): string {
    const t = this.getToken();
    if (!t) throw new CliError(`GitHub のトークンがありません。gh auth login --hostname ${this.cfg.host} するか、GITHUB_TOKEN を設定してください`);
    return t;
  }

  /** git にトークンを渡す設定。https の URL のときだけ、利用者の credential helper の後ろに足す */
  gitAuth(): { args: string[]; env: Record<string, string> } {
    if (!/^https:\/\//i.test(this.cfg.gitUrl)) return { args: [], env: {} };
    const t = this.getToken();
    if (!t) return { args: [], env: {} };
    return {
      args: ["-c", 'credential.helper=!f() { test "$1" = get && echo username=x-access-token && echo "password=$CCPLUCK_GIT_TOKEN"; }; f'],
      env: { CCPLUCK_GIT_TOKEN: t },
    };
  }

  private get apiBase(): string {
    return this.cfg.host === "github.com" ? "https://api.github.com" : `https://${this.cfg.host}/api/v3`;
  }

  private async api<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (this.ctx.env.CCPLUCK_DEBUG) this.ctx.io.err(`[api] ${method} ${path}`);
    const res = await this.ctx.fetch(`${this.apiBase}${path}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.requireToken()}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "ccpluck",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      let detail = "";
      try {
        const j = (await res.json()) as { message?: string; errors?: { message?: string }[] };
        detail = [j.message, ...(j.errors ?? []).map((e) => e.message)].filter(Boolean).join(": ");
      } catch {
        /* 本文が JSON でない */
      }
      throw new CliError(`GitHub の API がエラーを返しました（${method} ${path}）: ${res.status}${detail ? ` ${detail}` : ""}`);
    }
    return (await res.json()) as T;
  }

  // -------------------------------------------------------------------------
  // 手元の clone

  /** clone がなければ作る。あれば最新を取ってくる */
  async sync(): Promise<void> {
    const auth = this.gitAuth();
    const b = this.cfg.branch;
    if (!(await exists(this.dir))) {
      await git(this.ctx, [...auth.args, "clone", "--bare", "--quiet", "--single-branch", "--branch", b, this.cfg.gitUrl, this.dir], { env: auth.env });
      return;
    }
    await git(this.ctx, [...auth.args, "fetch", "--quiet", "--prune", "origin", `+refs/heads/${b}:refs/heads/${b}`], { cwd: this.dir, env: auth.env });
  }

  private async ensureClone(): Promise<void> {
    if (!(await exists(this.dir))) await this.sync();
  }

  async list(): Promise<PostEntry[]> {
    await this.ensureClone();
    const b = this.cfg.branch;
    const ls = await git(this.ctx, ["ls-tree", "-r", "--name-only", b, "--", "posts/"], { cwd: this.dir, allowFail: true });
    if (ls.code !== 0) return [];
    const files = new Set(ls.stdout.split("\n").filter((p) => POST_PATH_RE.test(p)));
    if (files.size === 0) return [];
    // 新しいコミットから見て、最初に出てきたコミットがそのファイルの版
    const log = await git(this.ctx, ["log", "--format=%x00%H%x09%cI", "--name-only", b, "--", "posts/"], { cwd: this.dir });
    const versions = new Map<string, { version: string; date: string }>();
    for (const chunk of log.stdout.split("\0").slice(1)) {
      const [head, ...paths] = chunk.split("\n");
      const [version, date] = (head ?? "").split("\t");
      if (!version || !date) continue;
      for (const p of paths) if (files.has(p) && !versions.has(p)) versions.set(p, { version, date });
    }
    const out: PostEntry[] = [];
    for (const p of files) {
      const m = POST_PATH_RE.exec(p)!;
      const v = versions.get(p);
      if (!v || !NAME_RE.test(m[1]!) || !NAME_RE.test(m[2]!)) continue;
      out.push({ remote: this.name, author: m[1]!, name: m[2]!, ...v });
    }
    return out.sort((a, b2) => (a.date < b2.date ? 1 : a.date > b2.date ? -1 : 0));
  }

  async read(author: string, name: string): Promise<PostWithBody | undefined> {
    if (!NAME_RE.test(author) || !NAME_RE.test(name)) return undefined;
    await this.ensureClone();
    const b = this.cfg.branch;
    const path = postPath(author, name);
    const show = await git(this.ctx, ["show", `${b}:${path}`], { cwd: this.dir, allowFail: true });
    if (show.code !== 0) return undefined;
    const log = await git(this.ctx, ["log", "-1", "--format=%H%x09%cI", b, "--", path], { cwd: this.dir });
    const [version = "", date = ""] = log.stdout.trim().split("\t");
    let raw: unknown;
    try {
      raw = JSON.parse(show.stdout);
    } catch (e) {
      throw new CliError(`${this.name}:${author}/${name} が JSON ではありません: ${(e as Error).message}`);
    }
    return { remote: this.name, author, name, version, date, raw };
  }

  async whoami(): Promise<Identity> {
    const u = await this.api<{ login: string; id: number }>("GET", "/user");
    const domain = this.cfg.host === "github.com" ? "users.noreply.github.com" : `users.noreply.${this.cfg.host}`;
    return { login: u.login, email: `${u.id}+${u.login}@${domain}` };
  }

  // -------------------------------------------------------------------------
  // 投稿する

  async submit(req: SubmitRequest): Promise<SubmitResult> {
    if (!NAME_RE.test(req.author) || !NAME_RE.test(req.name)) throw new CliError(`投稿の名前に使えない文字があります: ${req.author}/${req.name}`);
    await this.sync();
    const b = this.cfg.branch;
    const path = postPath(req.author, req.name);
    const branch = publishBranch(req.author, req.name);
    const [owner] = this.cfg.repo.split("/");

    // 公開済みと同じなら何もしない
    const cur = await git(this.ctx, ["show", `${b}:${path}`], { cwd: this.dir, allowFail: true });
    if (cur.code === 0 && cur.stdout === req.text) return { unchanged: true };

    // 作業ツリーを使わずに、最新の公開済みブランチに投稿ファイルを足したコミットを作る
    const tmp = await mkdtemp(join(tmpdir(), "ccpluck-index-"));
    let commit: string;
    try {
      const env = { GIT_INDEX_FILE: join(tmp, "index") };
      const blob = (await git(this.ctx, ["hash-object", "-w", "--stdin"], { cwd: this.dir, input: req.text })).stdout.trim();
      await git(this.ctx, ["read-tree", b], { cwd: this.dir, env });
      await git(this.ctx, ["update-index", "--add", "--cacheinfo", `100644,${blob},${path}`], { cwd: this.dir, env });
      const tree = (await git(this.ctx, ["write-tree"], { cwd: this.dir, env })).stdout.trim();
      const who = { GIT_AUTHOR_NAME: req.identity.login, GIT_AUTHOR_EMAIL: req.identity.email, GIT_COMMITTER_NAME: req.identity.login, GIT_COMMITTER_EMAIL: req.identity.email };
      const msg = `${req.update ? "update" : "publish"}: ${req.author}/${req.name}\n\n${req.title}\n`;
      commit = (await git(this.ctx, ["-c", "commit.gpgsign=false", "commit-tree", tree, "-p", b, "-F", "-"], { cwd: this.dir, env: { ...env, ...who }, input: msg })).stdout.trim();
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }

    // 投稿ごとのブランチに push する。自分のブランチなので、手元の状態で作り直して上書きする
    const auth = this.gitAuth();
    await git(this.ctx, [...auth.args, "push", "--quiet", "--force", "origin", `${commit}:refs/heads/${branch}`], { cwd: this.dir, env: auth.env });

    // PR が開いていれば、push で更新済み。なければ作る
    const open = await this.api<{ html_url: string }[]>("GET", `/repos/${this.cfg.repo}/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}`);
    if (open[0]) return { unchanged: false, url: open[0].html_url, created: false };
    const pr = await this.api<{ html_url: string }>("POST", `/repos/${this.cfg.repo}/pulls`, {
      title: `${req.update ? "更新" : "公開"}: ${req.author}/${req.name}${req.title ? ` — ${req.title}` : ""}`,
      head: branch,
      base: b,
      body: `\`ccpluck publish\` で作成した${req.update ? "更新" : "投稿"}です。\n\n- 投稿: \`${path}\`\n- もらう: \`ccpluck pick ${this.name}:${req.author}/${req.name}\`（マージ後）\n`,
    });
    return { unchanged: false, url: pr.html_url, created: true };
  }
}
