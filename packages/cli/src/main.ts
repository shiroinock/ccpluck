import { parseArgs, type ParseArgsConfig } from "node:util";
import { runApply } from "./commands/apply.js";
import { runExport } from "./commands/export.js";
import { runHistory, runRevert, runUndo } from "./commands/history.js";
import { CliError, resolvePaths, type Context } from "./context.js";

export const USAGE = `ccpick — Claude Code の settings.json を項目単位で取り込み・巻き戻す

使い方:
  ccpick apply <bundle>        差分とリスクを表示し、確認してから適用する
                               <bundle> はファイル、https URL、または - (標準入力)
      --yes                    全体の確認を省略する（high リスク項目は別途確認が必要）
      --allow-high <itemId>    非対話で high リスク項目を適用する（項目ごとに指定、複数可）
      --overwrite              衝突したら上書きする
      --skip-conflicts         衝突したらスキップする
      --dry-run                書き込まずに計画だけ表示する
  ccpick history [importId]    取り込み履歴の一覧（ID を渡すと詳細）
      --json
  ccpick undo <importId>       取り込み単位で戻す
      --force                  適用後に変更された項目を残して、ほかを戻す
  ccpick revert <itemId>       項目単位で戻す（適用後に変更されていたら止める）
      --import <importId>      どの取り込みの操作を戻すか指定する
  ccpick export --mask         手元の設定をマスクして投稿用の JSON を作る
      --public-env <KEY,...>   値を公開してよい env のキー
      --notes <file>           項目ごとの注釈（{ "<itemId>": { "why": "..." } }）
      --title <text> --os <macos|linux|windows|wsl|other> --tag <tag> --license <SPDX>
      -o, --output <file>      ファイルに書き出す（省略時は標準出力）
      --yes                    確認を省略する

共通オプション:
  --settings-path <path>       対象の settings.json（既定: ~/.claude/settings.json）
  --data-dir <path>            履歴の保存先（既定: ~/.ccpick）
  -h, --help
`;

const COMMON = {
  "settings-path": { type: "string" },
  "data-dir": { type: "string" },
  help: { type: "boolean", short: "h" },
} as const satisfies ParseArgsConfig["options"];

const COMMANDS = {
  apply: {
    ...COMMON,
    yes: { type: "boolean", short: "y" },
    "allow-high": { type: "string", multiple: true },
    overwrite: { type: "boolean" },
    "skip-conflicts": { type: "boolean" },
    "dry-run": { type: "boolean" },
  },
  history: { ...COMMON, json: { type: "boolean" } },
  undo: { ...COMMON, force: { type: "boolean" } },
  revert: { ...COMMON, import: { type: "string" } },
  export: {
    ...COMMON,
    mask: { type: "boolean" },
    "public-env": { type: "string", multiple: true },
    notes: { type: "string" },
    title: { type: "string" },
    os: { type: "string" },
    tag: { type: "string", multiple: true },
    license: { type: "string" },
    output: { type: "string", short: "o" },
    yes: { type: "boolean", short: "y" },
  },
} as const satisfies Record<string, ParseArgsConfig["options"]>;

type CommandName = keyof typeof COMMANDS;

export async function run(argv: string[], ctx: Context): Promise<number> {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === "-h" || cmd === "--help" || cmd === "help") {
    ctx.io.out(USAGE);
    return cmd ? 0 : 1;
  }
  if (!Object.hasOwn(COMMANDS, cmd)) {
    ctx.io.err(`不明なコマンドです: ${cmd}\n`);
    ctx.io.err(USAGE);
    return 1;
  }
  try {
    return await dispatch(cmd as CommandName, rest, ctx);
  } catch (e) {
    if (e instanceof CliError) {
      ctx.io.err(`エラー: ${e.message}`);
      return e.exitCode;
    }
    if (e instanceof TypeError && "code" in e && String(e.code).startsWith("ERR_PARSE_ARGS")) {
      ctx.io.err(`エラー: ${e.message}`);
      return 1;
    }
    throw e;
  }
}

async function dispatch(cmd: CommandName, args: string[], ctx: Context): Promise<number> {
  const { values: v, positionals } = parseArgs({ args, options: COMMANDS[cmd], allowPositionals: true, strict: true });
  const o = v as Record<string, string | string[] | boolean | undefined>;
  if (o.help) {
    ctx.io.out(USAGE);
    return 0;
  }
  const paths = resolvePaths(ctx, {
    settingsPath: o["settings-path"] as string | undefined,
    dataDir: o["data-dir"] as string | undefined,
  });
  const one = (what: string) => {
    if (positionals.length !== 1) throw new CliError(`${what} を 1 つ指定してください`);
    return positionals[0] as string;
  };
  const list = (k: string) => ((o[k] as string[] | undefined) ?? []).flatMap((x) => x.split(",")).map((x) => x.trim()).filter(Boolean);

  switch (cmd) {
    case "apply": {
      if (o.overwrite && o["skip-conflicts"]) throw new CliError("--overwrite と --skip-conflicts は同時に指定できません");
      return runApply(ctx, {
        ...paths,
        input: one("<bundle>"),
        yes: Boolean(o.yes),
        allowHigh: (o["allow-high"] as string[] | undefined) ?? [],
        ...(o.overwrite ? { onConflict: "overwrite" as const } : o["skip-conflicts"] ? { onConflict: "skip" as const } : {}),
        dryRun: Boolean(o["dry-run"]),
      });
    }
    case "history":
      if (positionals.length > 1) throw new CliError("importId は 1 つだけ指定できます");
      return runHistory(ctx, { ...paths, ...(positionals[0] ? { id: positionals[0] } : {}), json: Boolean(o.json) });
    case "undo":
      return runUndo(ctx, { ...paths, id: one("<importId>"), force: Boolean(o.force) });
    case "revert":
      return runRevert(ctx, {
        ...paths,
        itemId: one("<itemId>"),
        ...(o.import ? { importId: o.import as string } : {}),
      });
    case "export":
      if (positionals.length > 0) throw new CliError("export は位置引数を取りません");
      return runExport(ctx, {
        settingsPath: paths.settingsPath,
        mask: Boolean(o.mask),
        publicEnv: list("public-env"),
        tags: list("tag"),
        yes: Boolean(o.yes),
        ...(o.notes ? { notesPath: o.notes as string } : {}),
        ...(o.output ? { output: o.output as string } : {}),
        ...(o.title ? { title: o.title as string } : {}),
        ...(o.os ? { os: o.os as string } : {}),
        ...(o.license ? { license: o.license as string } : {}),
      });
  }
}
