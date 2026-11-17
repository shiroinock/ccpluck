import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { emitKeypressEvents } from "node:readline";
import { createInterface } from "node:readline/promises";

/** 入出力。テストでは差し替える */
export interface Io {
  /** 標準出力（export の結果など、パイプで使うもの） */
  out(text: string): void;
  /** 標準エラー（表示・確認画面） */
  err(text: string): void;
  /** 対話的に質問できるか */
  interactive: boolean;
  /** 1 行の回答を得る。interactive が false のときは呼ばない */
  ask(question: string): Promise<string>;
  /**
   * 1 キーで答えてもらう（Enter 不要）。返すのは keys のどれか（小文字）。
   * 用意がない環境では ask で 1 行を読んで代わりにする
   */
  key?(prompt: string, keys: string[]): Promise<string>;
  /** エディタ（$VISUAL / $EDITOR）で文章を書いてもらう。用意がない環境では undefined */
  edit?(initial: string): Promise<string>;
  /** 標準入力全体（`apply -` 用） */
  readStdin(): Promise<string>;
  color: boolean;
}

export interface Context {
  io: Io;
  env: Record<string, string | undefined>;
  homeDir: string;
  cwd: string;
  platform: NodeJS.Platform;
  now: () => Date;
  fetch: typeof fetch;
}

export function nodeContext(): Context {
  const interactive = Boolean(process.stdin.isTTY && process.stderr.isTTY);
  const io: Io = {
    out: (t) => process.stdout.write(t.endsWith("\n") ? t : `${t}\n`),
    err: (t) => process.stderr.write(t.endsWith("\n") ? t : `${t}\n`),
    interactive,
    async ask(q) {
      // 質問のたびに開いて閉じる。開いたままだと処理が終わってもプロセスが終了しない
      const rl = createInterface({ input: process.stdin, output: process.stderr });
      try {
        return await rl.question(q);
      } finally {
        rl.close();
      }
    },
    async key(prompt, keys) {
      const stdin = process.stdin;
      emitKeypressEvents(stdin);
      process.stderr.write(prompt);
      stdin.setRawMode(true);
      stdin.resume();
      try {
        return await new Promise<string>((resolveKey) => {
          const onKey = (str: string | undefined, k: { name?: string; ctrl?: boolean } | undefined) => {
            if (k?.ctrl && (k.name === "c" || k.name === "d")) {
              stdin.setRawMode(false);
              process.stderr.write("\n中止しました（何も書き込んでいません）\n");
              process.exit(130);
            }
            const ch = (str ?? k?.name ?? "").toLowerCase();
            if (!keys.includes(ch)) return;
            stdin.off("keypress", onKey);
            process.stderr.write(`${ch}\n`);
            resolveKey(ch);
          };
          stdin.on("keypress", onKey);
        });
      } finally {
        stdin.setRawMode(false);
        stdin.pause();
      }
    },
    async edit(initial) {
      const dir = await mkdtemp(join(tmpdir(), "ccpick-"));
      const file = join(dir, "why.txt");
      try {
        await writeFile(file, initial, { mode: 0o600 });
        const editor = process.env.VISUAL || process.env.EDITOR || "vi";
        // エディタ名に引数が含まれることがある（"code --wait" など）
        const r = spawnSync(`${editor} "${file}"`, { stdio: "inherit", shell: true });
        if (r.status !== 0) throw new CliError(`エディタが異常終了しました: ${editor}`);
        return await readFile(file, "utf8");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    async readStdin() {
      const chunks: Buffer[] = [];
      for await (const c of process.stdin) chunks.push(c as Buffer);
      return Buffer.concat(chunks).toString("utf8");
    },
    color: Boolean(process.stderr.isTTY) && !process.env.NO_COLOR,
  };
  return {
    io,
    env: process.env,
    homeDir: homedir(),
    cwd: process.cwd(),
    platform: process.platform,
    now: () => new Date(),
    fetch: globalThis.fetch,
  };
}

export interface Paths {
  settingsPath: string;
  dataDir: string;
}

function expandHome(p: string, home: string): string {
  return p === "~" ? home : p.startsWith("~/") ? join(home, p.slice(2)) : p;
}

/**
 * 対象ファイルと履歴の保存先を決める。
 * settings: --settings-path > $CLAUDE_CONFIG_DIR/settings.json > ~/.claude/settings.json
 * 履歴:     --data-dir > $CCPICK_HOME > ~/.ccpick
 */
export function resolvePaths(ctx: Context, opts: { settingsPath?: string; dataDir?: string }): Paths {
  const home = ctx.homeDir;
  const settingsPath = opts.settingsPath
    ? resolve(ctx.cwd, expandHome(opts.settingsPath, home))
    : join(ctx.env.CLAUDE_CONFIG_DIR ? expandHome(ctx.env.CLAUDE_CONFIG_DIR, home) : join(home, ".claude"), "settings.json");
  const dataDir = opts.dataDir
    ? resolve(ctx.cwd, expandHome(opts.dataDir, home))
    : ctx.env.CCPICK_HOME
      ? expandHome(ctx.env.CCPICK_HOME, home)
      : join(home, ".ccpick");
  return { settingsPath, dataDir };
}

export class CliError extends Error {
  constructor(
    message: string,
    public readonly exitCode = 1,
  ) {
    super(message);
    this.name = "CliError";
  }
}
