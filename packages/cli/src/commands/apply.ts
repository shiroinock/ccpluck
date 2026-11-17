import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  assessRisk,
  containsMasked,
  fillMasked,
  findMaskedLabels,
  mergeItems,
  withValue,
  parseBundle,
  type ConflictDecision,
  type Dependency,
  type Item,
  type MergeResult,
  type Notes,
  type SkipReason,
} from "@ccpick/core";
import { CliError, type Context } from "../context.js";
import { exists, readSettingsFile, sha256, writeSettings } from "../fsutil.js";
import { indent, itemLine, makeStyle, pretty, riskBadge, short } from "../render.js";
import { Store, type ImportRecord } from "../store.js";

export interface ApplyOptions {
  input: string;
  settingsPath: string;
  dataDir: string;
  /** 全体の確認を省略する（high は別途確認が必要） */
  yes: boolean;
  /** 非対話で high 項目を適用する場合に、項目 ID を明示する */
  allowHigh: string[];
  /** 衝突時の既定の扱い */
  onConflict?: ConflictDecision;
  dryRun: boolean;
}

const SKIP_LABEL: Record<SkipReason, string> = {
  unchanged: "同じ値がすでにある",
  duplicate: "同じものがすでにある",
  "conflict-skip": "衝突（スキップを選択）",
  "conflict-unresolved": "衝突（未選択のためスキップ）",
  "needs-confirmation": "high リスクで未確認のためスキップ",
  masked: "マスク値が残っているためスキップ",
  "invalid-target": "既存の設定の形が合わず適用できない",
};

async function loadInput(ctx: Context, input: string): Promise<unknown> {
  let text: string;
  if (input === "-") {
    text = await ctx.io.readStdin();
  } else if (/^https?:\/\//i.test(input)) {
    if (!/^https:\/\//i.test(input) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(input)) {
      throw new CliError("バンドルの URL は https のみ対応しています");
    }
    const res = await ctx.fetch(input);
    if (!res.ok) throw new CliError(`バンドルを取得できません: ${res.status} ${res.statusText}`);
    text = await res.text();
  } else {
    try {
      text = await readFile(resolve(ctx.cwd, input), "utf8");
    } catch (e) {
      throw new CliError(`バンドルを読めません: ${(e as Error).message}`);
    }
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new CliError(`バンドルが JSON ではありません: ${(e as Error).message}`);
  }
}

async function askChoice(ctx: Context, q: string, choices: string[]): Promise<string> {
  for (;;) {
    const a = (await ctx.io.ask(q)).trim().toLowerCase();
    if (choices.includes(a)) return a;
    ctx.io.err(`  ${choices.join(" / ")} のどれかを入力してください`);
  }
}

/** 依存ファイルの存在確認。プロジェクト起点のものは確認できないので別扱い */
async function checkDependencies(ctx: Context, deps: Dependency[]) {
  const missing: Dependency[] = [];
  const unknown: Dependency[] = [];
  for (const d of deps) {
    if (d.base === "project") {
      unknown.push(d);
      continue;
    }
    const p =
      d.base === "home"
        ? join(ctx.homeDir, d.path.replace(/^(~|\$HOME|\$\{HOME\})\/?/, ""))
        : d.path;
    if (!(await exists(p))) missing.push(d);
  }
  return { missing, unknown };
}

export async function runApply(ctx: Context, opts: ApplyOptions): Promise<number> {
  const { io } = ctx;
  const s = makeStyle(io.color);

  // 1. バンドルを読む
  const parsed = parseBundle(await loadInput(ctx, opts.input));
  if (parsed.errors.length > 0) {
    throw new CliError(`バンドルに不正な項目があるため中止しました:\n  ${parsed.errors.join("\n  ")}`);
  }
  for (const w of parsed.warnings) io.err(s.yellow(`警告: ${w.message}${w.at ? `: ${w.at}` : ""}`));
  if (parsed.items.length === 0) {
    io.err("取り込む項目がありません");
    return 0;
  }
  const notes: Notes = parsed.notes;
  const file = await readSettingsFile(opts.settingsPath);

  io.err(s.bold(`\n取り込み元: ${parsed.source?.title ?? opts.input}`));
  io.err(s.dim(`対象: ${opts.settingsPath}${file.text === null ? "（新規作成）" : ""}\n`));

  // 2. マスク値の入力
  let items: Item[] = [];
  for (const item of parsed.items) {
    if (!containsMasked(item.value)) {
      items.push(item);
      continue;
    }
    const labels = findMaskedLabels(item.value);
    if (!io.interactive) {
      io.err(s.yellow(`マスク値を含むためスキップ: ${item.id}`));
      continue;
    }
    io.err(`${s.bold(item.id)} にはマスクされた値があります。空のまま Enter でこの項目をスキップします`);
    const values: Record<string, string> = {};
    let skipped = false;
    for (const label of labels) {
      const v = await io.ask(`  ${label} の値: `);
      if (v === "") {
        skipped = true;
        break;
      }
      values[label] = v;
    }
    if (skipped) continue;
    const filled = fillMasked(item.value, values);
    // hook の command など ID に値が含まれる項目は、埋めた値から ID を作り直す
    items.push(withValue(item, filled));
  }

  // 3. 衝突の判断（high は全部確認済みとみなして下見する）
  const allIds = items.map((i) => i.id);
  const preview = mergeItems(file.settings, items, { confirmedHighRisk: allIds });
  const decisions: Record<string, ConflictDecision> = {};
  for (const c of preview.conflicts) {
    io.err(`${s.yellow("衝突")} ${s.bold(c.itemId)}`);
    io.err(`  いまの値:   ${short(c.existing)}`);
    io.err(`  取り込む値: ${short(c.incoming)}`);
    if (opts.onConflict) decisions[c.itemId] = opts.onConflict;
    else if (io.interactive) {
      const a = await askChoice(ctx, "  上書きしますか? [o]上書き / [s]スキップ: ", ["o", "s"]);
      decisions[c.itemId] = a === "o" ? "overwrite" : "skip";
    } else decisions[c.itemId] = "skip";
  }

  // 4. high リスク項目の確認（全文を表示し、yes の入力を求める）
  const preview2 = mergeItems(file.settings, items, { confirmedHighRisk: allIds, decisions });
  const willApply = new Set(preview2.applied.map((o) => o.itemId));
  const confirmed: string[] = [];
  for (const item of items) {
    if (!willApply.has(item.id)) continue;
    const risk = assessRisk(item);
    if (risk.level !== "high") continue;
    io.err(`\n${riskBadge("high", s)} ${s.bold(item.id)}`);
    for (const m of risk.matched.filter((x) => x.level === "high")) io.err(s.red(`  ! ${m.reason}`));
    if (notes[item.id]?.why) io.err(`  理由: ${notes[item.id]!.why}`);
    io.err(indent(pretty(item.value)));
    if (opts.allowHigh.includes(item.id)) {
      io.err(s.dim("  --allow-high で確認済み"));
      confirmed.push(item.id);
    } else if (io.interactive) {
      const a = (await io.ask('  この項目を適用するなら "yes" と入力してください: ')).trim();
      if (a === "yes") confirmed.push(item.id);
    } else {
      io.err(s.yellow("  非対話のため適用しません（適用するには --allow-high にこの ID を指定してください）"));
    }
  }

  // 5. 本番のマージ
  const result = mergeItems(file.settings, items, { decisions, confirmedHighRisk: confirmed });
  printPlan(ctx, result, items, notes);
  const deps = await checkDependencies(ctx, result.dependencies);
  if (deps.missing.length > 0) {
    io.err(s.bold(s.yellow("\n依存ファイル不足")));
    for (const d of deps.missing) io.err(`  ${d.path}  ${s.dim(`(${d.itemId})`)}`);
    io.err(s.dim("  これらのスクリプトは取り込まれません。別途入手して配置してください"));
  }
  if (deps.unknown.length > 0) {
    io.err(s.dim(`\nプロジェクト内のファイルを参照しています（存在は確認していません）:`));
    for (const d of deps.unknown) io.err(s.dim(`  ${d.path}`));
  }

  if (result.applied.length === 0) {
    io.err("\n変更はありません");
    return 0;
  }
  if (opts.dryRun) {
    io.err(s.dim("\n--dry-run のため書き込みません"));
    return 0;
  }
  if (!opts.yes) {
    if (!io.interactive) throw new CliError("確認が必要です。内容を確認したうえで --yes を付けて実行してください");
    const a = (await io.ask(`\n${result.applied.length} 件を適用しますか? [y/N] `)).trim().toLowerCase();
    if (a !== "y" && a !== "yes") {
      io.err("中止しました");
      return 1;
    }
  }

  // 6. 記録してから書き込む
  const store = new Store(opts.dataDir);
  const id = store.newId(ctx.now());
  const afterText = JSON.stringify(result.settings, null, file.format.indent) + (file.format.trailingNewline ? "\n" : "");
  const rec: ImportRecord = {
    version: 1,
    id,
    createdAt: ctx.now().toISOString(),
    settingsPath: opts.settingsPath,
    source: { input: opts.input, ...parsed.source },
    beforeText: file.text,
    afterSha256: sha256(afterText),
    ops: result.applied,
    reverted: [],
    status: "applied",
  };
  await store.save(rec);
  try {
    const written = await writeSettings(opts.settingsPath, result.settings, file.format);
    if (sha256(written) !== rec.afterSha256) throw new Error("internal: written text mismatch");
  } catch (e) {
    await store.remove(id);
    throw e;
  }
  io.err(s.green(`\n適用しました。importId: ${id}`));
  io.err(s.dim(`戻すには: ccpick undo ${id}`));
  return 0;
}

function printPlan(ctx: Context, result: MergeResult, items: Item[], notes: Notes): void {
  const s = makeStyle(ctx.io.color);
  const byId = new Map(items.map((i) => [i.id, i]));
  ctx.io.err(s.bold(`\n適用する項目 (${result.applied.length})`));
  for (const op of result.applied) {
    const item = byId.get(op.itemId)!;
    const mark = op.op === "add" ? s.green("+") : s.yellow("~");
    ctx.io.err(`  ${mark} ${riskBadge(assessRisk(item).level, s)} ${itemLine(item)}`);
    if (op.op === "replace") ctx.io.err(s.dim(`      いまの値: ${short(op.before)}`));
    const why = notes[op.itemId]?.why;
    if (why) ctx.io.err(s.dim(`      理由: ${why}`));
  }
  if (result.skipped.length > 0) {
    ctx.io.err(s.bold(`\n適用しない項目 (${result.skipped.length})`));
    for (const sk of result.skipped) ctx.io.err(`  - ${sk.itemId}  ${s.dim(SKIP_LABEL[sk.reason])}`);
  }
  for (const w of result.warnings) ctx.io.err(s.yellow(`\n警告: ${w.message}`));
}
