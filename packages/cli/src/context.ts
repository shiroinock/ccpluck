import { homedir } from "node:os";
import { join, resolve } from "node:path";
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
  let rl: ReturnType<typeof createInterface> | undefined;
  const io: Io = {
    out: (t) => process.stdout.write(t.endsWith("\n") ? t : `${t}\n`),
    err: (t) => process.stderr.write(t.endsWith("\n") ? t : `${t}\n`),
    interactive,
    async ask(q) {
      rl ??= createInterface({ input: process.stdin, output: process.stderr });
      return rl.question(q);
    },
    async readStdin() {
      const chunks: Buffer[] = [];
      for await (const c of process.stdin) chunks.push(c as Buffer);
      return Buffer.concat(chunks).toString("utf8");
    },
    color: Boolean(process.stderr.isTTY) && !process.env.NO_COLOR,
  };
  process.on("exit", () => rl?.close());
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
