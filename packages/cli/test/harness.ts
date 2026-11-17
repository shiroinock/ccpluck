import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { run, type Context } from "../src/index.js";

export interface Harness {
  dir: string;
  home: string;
  settingsPath: string;
  dataDir: string;
  stdout: string[];
  stderr: string[];
  /** 対話の回答（先頭から順に消費する） */
  answers: string[];
  questions: string[];
  ctx: Context;
  /** 共通オプション付きで実行する */
  cli(...args: string[]): Promise<number>;
  readSettings(): string | null;
  writeSettings(text: string): void;
  writeJson(name: string, value: unknown): string;
  err(): string;
  out(): string;
}

export function harness(opts: { interactive?: boolean; fetch?: typeof fetch } = {}): Harness {
  const dir = mkdtempSync(join(tmpdir(), "ccpick-test-"));
  const home = join(dir, "home");
  mkdirSync(home, { recursive: true });
  const settingsPath = join(home, ".claude", "settings.json");
  const dataDir = join(home, ".ccpick");
  let clock = Date.parse("2026-11-18T00:00:00Z");
  const h: Harness = {
    dir,
    home,
    settingsPath,
    dataDir,
    stdout: [],
    stderr: [],
    answers: [],
    questions: [],
    ctx: undefined as unknown as Context,
    cli: (...args) => run([...args, "--settings-path", settingsPath, "--data-dir", dataDir], h.ctx),
    readSettings: () => (existsSync(settingsPath) ? readFileSync(settingsPath, "utf8") : null),
    writeSettings: (text) => {
      mkdirSync(dirname(settingsPath), { recursive: true });
      writeFileSync(settingsPath, text);
    },
    writeJson: (name, value) => {
      const p = join(dir, name);
      writeFileSync(p, JSON.stringify(value));
      return p;
    },
    err: () => h.stderr.join("\n"),
    out: () => h.stdout.join("\n"),
  };
  h.ctx = {
    io: {
      out: (t) => h.stdout.push(t),
      err: (t) => h.stderr.push(t),
      interactive: opts.interactive ?? false,
      async ask(q) {
        h.questions.push(q);
        const a = h.answers.shift();
        if (a === undefined) throw new Error(`unexpected question: ${q}`);
        return a;
      },
      readStdin: async () => "",
      color: false,
    },
    env: {},
    homeDir: home,
    cwd: dir,
    platform: "darwin",
    now: () => new Date((clock += 1000)),
    fetch: opts.fetch ?? (async () => new Response("not found", { status: 404 })),
  };
  return h;
}

/** ディレクトリに一時ファイル（.tmp）が残っていないか */
export function leftoverTmp(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".tmp")) : [];
}

export function bundle(items: { id: string; value: unknown }[], extra: Record<string, unknown> = {}) {
  return { format: "ccpick-bundle", version: 1, items, ...extra };
}
