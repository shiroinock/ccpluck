import { rm } from "node:fs/promises";
import { CliError, type Context } from "../context.js";
import { git } from "../git.js";
import { GitHubBackend } from "../github.js";
import { openBackend, parseRemoteSpec, REMOTE_NAME_RE, RemoteStore, type RemoteConfig } from "../remotes.js";
import { makeStyle } from "../render.js";

export interface RemoteOptions {
  dataDir: string;
  action: string;
  args: string[];
  host?: string;
  gitUrl?: string;
}

export async function runRemote(ctx: Context, opts: RemoteOptions): Promise<number> {
  const store = new RemoteStore(opts.dataDir);
  switch (opts.action) {
    case "add":
      return add(ctx, store, opts);
    case "list":
    case undefined:
    case "":
      return list(ctx, store);
    case "sync":
      return sync(ctx, store, opts.args);
    case "remove":
      return remove(ctx, store, opts.args);
    default:
      throw new CliError(`remote のサブコマンドは add / list / sync / remove です: ${opts.action}`);
  }
}

async function add(ctx: Context, store: RemoteStore, opts: RemoteOptions): Promise<number> {
  const s = makeStyle(ctx.io.color);
  const [name, spec] = opts.args;
  if (!name || !spec || opts.args.length !== 2) throw new CliError("ccpluck remote add <名前> github:<owner>/<repo> の形で指定してください");
  if (!REMOTE_NAME_RE.test(name)) throw new CliError(`置き場所の名前は英数字・ハイフン・アンダースコアで 40 文字までです: ${name}`);
  const f = await store.load();
  if (Object.hasOwn(f.remotes, name)) throw new CliError(`置き場所 ${name} はすでに登録されています`);
  const { kind, repo } = parseRemoteSpec(spec);
  const host = opts.host ?? "github.com";
  if (!/^[A-Za-z0-9.-]+(:\d+)?$/.test(host)) throw new CliError(`ホスト名が不正です: ${host}`);
  const gitUrl = opts.gitUrl ?? `https://${host}/${repo}.git`;
  const cfg: RemoteConfig = { kind, repo, host, gitUrl, branch: "main", addedAt: ctx.now().toISOString() };

  // 既定のブランチを調べてから clone する
  ctx.io.err(`${gitUrl} を取得しています…`);
  const auth = new GitHubBackend(ctx, name, cfg, store.cloneDir(name)).gitAuth();
  const ls = await git(ctx, [...auth.args, "ls-remote", "--symref", gitUrl, "HEAD"], { env: auth.env });
  const m = /^ref: refs\/heads\/(\S+)\s+HEAD/m.exec(ls.stdout);
  if (!m) throw new CliError(`${gitUrl} は空のリポジトリのようです。先に main ブランチを作ってください`);
  cfg.branch = m[1]!;

  await rm(store.cloneDir(name), { recursive: true, force: true });
  const backend = openBackend(ctx, opts.dataDir, name, cfg);
  await backend.sync();
  f.remotes[name] = cfg;
  await store.save(f);
  const posts = await backend.list();
  ctx.io.err(s.green(`置き場所 ${name}（${backend.label}）を登録しました：投稿 ${posts.length} 件`));
  ctx.io.err(s.dim(`投稿を探す: ccpluck search --in ${name}　公開する: ccpluck publish --to ${name}`));
  return 0;
}

async function list(ctx: Context, store: RemoteStore): Promise<number> {
  const f = await store.load();
  const names = Object.keys(f.remotes);
  if (names.length === 0) {
    ctx.io.err("登録した置き場所はありません（ccpluck remote add <名前> github:<owner>/<repo>）");
    return 0;
  }
  for (const n of names) {
    const c = f.remotes[n]!;
    ctx.io.out(`${n}\tgithub:${c.repo}${c.host === "github.com" ? "" : `\t${c.host}`}\t${c.branch}`);
  }
  return 0;
}

async function sync(ctx: Context, store: RemoteStore, args: string[]): Promise<number> {
  const f = await store.load();
  const names = args.length > 0 ? args : Object.keys(f.remotes);
  if (names.length === 0) {
    ctx.io.err("登録した置き場所はありません");
    return 0;
  }
  let code = 0;
  for (const n of names) {
    if (!Object.hasOwn(f.remotes, n)) throw new CliError(`置き場所 ${n} は登録されていません`);
    const b = openBackend(ctx, store.dataDir, n, f.remotes[n]!);
    try {
      await b.sync();
      ctx.io.err(`${n}: 投稿 ${(await b.list()).length} 件`);
    } catch (e) {
      if (!(e instanceof CliError)) throw e;
      ctx.io.err(`${n}: ${e.message}`);
      code = 1;
    }
  }
  return code;
}

async function remove(ctx: Context, store: RemoteStore, args: string[]): Promise<number> {
  const [name] = args;
  if (!name || args.length !== 1) throw new CliError("ccpluck remote remove <名前> の形で指定してください");
  const f = await store.load();
  if (!Object.hasOwn(f.remotes, name)) throw new CliError(`置き場所 ${name} は登録されていません`);
  delete f.remotes[name];
  await store.save(f);
  await rm(store.cloneDir(name), { recursive: true, force: true });
  ctx.io.err(`置き場所 ${name} を外しました（取り込んだ設定と履歴はそのままです）`);
  return 0;
}
