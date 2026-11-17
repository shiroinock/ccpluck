import { spawn } from "node:child_process";
import { CliError, type Context } from "./context.js";

export interface GitOptions {
  /** git -C に渡すディレクトリ */
  cwd?: string;
  /** 標準入力に渡す文字列 */
  input?: string;
  /** 追加の環境変数 */
  env?: Record<string, string>;
  /** 失敗しても例外にしない */
  allowFail?: boolean;
}

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * git を実行する。対話のプロンプト（パスワード入力など）は出させない。
 * 環境変数は ctx.env を優先する（テストで HOME や設定を差し替えるため）
 */
export function git(ctx: Context, args: string[], opts: GitOptions = {}): Promise<GitResult> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...process.env, ...ctx.env, ...opts.env })) if (v !== undefined) env[k] = v;
  env.GIT_TERMINAL_PROMPT = "0";
  const full = [...(opts.cwd ? ["-C", opts.cwd] : []), ...args];
  // CCPLUCK_DEBUG=1 で実行する git を表示する（トークンを渡す helper の中身は出さない）
  if (ctx.env.CCPLUCK_DEBUG) ctx.io.err(`[git] ${args.map((x) => (x.startsWith("credential.helper=") ? "credential.helper=<ccpluck>" : x)).join(" ")}`);
  return new Promise((resolveRun, reject) => {
    const p = spawn("git", full, { env, stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    p.stdout.on("data", (b: Buffer) => out.push(b));
    p.stderr.on("data", (b: Buffer) => err.push(b));
    p.on("error", (e) => {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") reject(new CliError("git が見つかりません。git をインストールしてください"));
      else reject(e);
    });
    p.on("close", (code) => {
      const r = { code: code ?? 1, stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8") };
      if (r.code !== 0 && !opts.allowFail) {
        reject(new CliError(`git ${args[0]} に失敗しました: ${r.stderr.trim() || `終了コード ${r.code}`}`));
      } else resolveRun(r);
    });
    p.stdin.end(opts.input ?? "");
  });
}
