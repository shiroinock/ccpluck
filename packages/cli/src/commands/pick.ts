import {
  containsMasked,
  decide,
  deferPick,
  describeItem,
  emptyPickState,
  itemDependencies,
  itemGroup,
  itemLabel,
  itemValueText,
  parsePickSource,
  pickCandidates,
  pickView,
  undoPick,
  type ConflictDecision,
  type Notes,
  type PickCandidate,
  type PickState,
} from "@ccpluck/core";
import { CliError, type Context } from "../context.js";
import { readSettingsFile } from "../fsutil.js";
import { PickMemoryStore, valueHash, type PickMemory } from "../pick-memory.js";
import { indent, makeStyle, riskBadge, short, type Style } from "../render.js";
import { formatRef } from "../backend.js";
import { resolvePostInput, shortDate, shortVersion, type ResolvedPost } from "../post-input.js";
import { applyItems } from "./apply.js";

export interface PickOptions {
  input: string;
  settingsPath: string;
  dataDir: string;
  /** 前回決めた項目も出す */
  all: boolean;
  /** 対話せずに、指定した項目だけを取り込む */
  only: string[];
  /** 対話せずに、low で自分の設定にない項目だけを取り込む */
  yesLow: boolean;
  /** 最後の確認を省略する（high は別途確認が必要） */
  yes: boolean;
  allowHigh: string[];
  dryRun: boolean;
  /** 置き場所の最新を取らずに、手元の写しで選ぶ */
  offline?: boolean;
}

const KEYS = ["y", "n", "l", "z", "?", "q"];
const PROMPT = "[y] もらう  [n] もらわない  [l] あとで  [z] ひとつ戻す  [?] 詳しく  [q] ここで終える > ";

export async function runPick(ctx: Context, opts: PickOptions): Promise<number> {
  const { io } = ctx;
  const s = makeStyle(io.color);
  const batch = opts.only.length > 0 || opts.yesLow;
  if (!batch && !io.interactive) {
    throw new CliError("端末でないため 1 件ずつ選べません。--only <項目 ID> か --yes-low を指定してください");
  }
  if (!batch && opts.input === "-") {
    throw new CliError("1 件ずつ選ぶときは標準入力から読めません（キー入力に使うため）。ファイルか URL を指定してください");
  }

  // 1. 投稿と自分の設定を読む
  const resolved = await resolvePostInput(ctx, opts.dataDir, opts.input, { offline: Boolean(opts.offline), style: s });
  const src = parsePickSource(resolved.raw);
  if (src.errors.length > 0) throw new CliError(`投稿を読めません:\n  ${src.errors.join("\n  ")}`);
  for (const w of src.warnings) io.err(s.yellow(`警告: ${w.message}${w.at ? `: ${w.at}` : ""}`));
  if (src.items.length === 0) {
    io.err("取り込める項目がありません");
    return 0;
  }
  const file = await readSettingsFile(opts.settingsPath);
  const all = pickCandidates(src.items, src.notes, file.settings);

  // 2. 前回決めた項目（値が変わっていないもの）は出さない
  const key = resolved.sourceKey;
  const memStore = new PickMemoryStore(opts.dataDir);
  const memory = key ? await memStore.load(key) : undefined;
  const decidedBefore = (c: PickCandidate) => {
    const m = memory?.decisions[c.item.id];
    return m !== undefined && Object.hasOwn(memory!.decisions, c.item.id) && m.valueHash === valueHash(c.item.value);
  };
  const cands = opts.all || opts.only.length > 0 ? all : all.filter((c) => !decidedBefore(c));
  const skippedBefore = all.length - cands.length;

  const title = src.meta?.title ?? src.source?.title ?? opts.input;
  printHeader(ctx, s, { title, src, opts, fileExists: file.text !== null, all, skippedBefore, resolved });

  // 3. 選ぶ
  let state: PickState = emptyPickState();
  if (batch) state = selectBatch(cands, opts, src.items.map((i) => i.id));
  else state = await timeline(ctx, s, cands, src.notes);

  // 4. まとめ
  const view = pickView(cands, state);
  const chosen = cands.filter((c) => state.decisions[c.item.id] === "in");
  const declined = cands.filter((c) => state.decisions[c.item.id] === "out");
  const high = chosen.filter((c) => c.risk.level === "high").length;
  const replace = chosen.filter((c) => c.mine.kind === "differs").length;
  const undecided = view.total - view.decided;
  if (!batch) {
    io.err(
      s.bold(`\nもらう ${chosen.length} 件`) +
        (chosen.length > 0 ? `（high ${high}、置き換え ${replace}）` : "") +
        `、もらわない ${declined.length} 件` +
        (undecided > 0 ? s.dim(`、決めていない ${undecided} 件（次回の pick でまた出ます）`) : ""),
    );
  }

  const remember = async () => {
    if (!key || opts.dryRun || opts.only.length > 0) return;
    const now = ctx.now().toISOString();
    const mem: PickMemory = {
      version: 1,
      sourceKey: key,
      ...(title !== opts.input ? { title } : {}),
      ...(resolved.post ? { postVersion: resolved.post.version } : {}),
      updatedAt: now,
      decisions: { ...(memory?.decisions ?? {}) },
    };
    for (const c of [...chosen, ...declined]) {
      Object.defineProperty(mem.decisions, c.item.id, {
        value: { decision: state.decisions[c.item.id]!, valueHash: valueHash(c.item.value), at: now },
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    await memStore.save(mem);
  };

  if (chosen.length === 0) {
    io.err("取り込む項目はありません");
    await remember();
    return 0;
  }

  // 5. 取り込む（マスク値の入力、high の確認、書き込み、履歴は apply と同じ）
  const notes: Notes = {};
  for (const c of chosen) {
    if (c.why) Object.defineProperty(notes, c.item.id, { value: { why: c.why }, enumerable: true, writable: true, configurable: true });
  }
  // 「置き換わります」を見たうえでもらうと決めた項目は、もう一度は聞かない
  const decisions: Record<string, ConflictDecision> = {};
  for (const c of chosen) if (c.mine.kind === "differs") decisions[c.item.id] = "overwrite";
  const source = {
    input: opts.input,
    ...(title !== opts.input ? { title } : {}),
    ...(resolved.url ? { url: resolved.url } : {}),
    ...(resolved.post ? { author: resolved.post.author } : src.source?.author ? { author: src.source.author } : {}),
    ...(resolved.post ? { post: formatRef(resolved.post), version: resolved.post.version } : {}),
  };
  const r = await applyItems(ctx, {
    settingsPath: opts.settingsPath,
    dataDir: opts.dataDir,
    yes: opts.yes,
    allowHigh: opts.allowHigh,
    dryRun: opts.dryRun,
    items: chosen.map((c) => c.item),
    notes,
    source,
    file,
    decisions,
    defaultYes: !batch,
  });
  if (r.code === 0 && !r.aborted) await remember();
  return r.code;
}

function printHeader(
  ctx: Context,
  s: Style,
  p: {
    title: string;
    src: ReturnType<typeof parsePickSource>;
    opts: PickOptions;
    fileExists: boolean;
    all: PickCandidate[];
    skippedBefore: number;
    resolved: ResolvedPost;
  },
): void {
  const { io } = ctx;
  const meta = p.src.meta;
  const post = p.resolved.post;
  const author = post?.author ?? p.src.source?.author;
  const tags = [meta?.os, ...(meta?.tags ?? []).map((t) => `#${t}`), author && `by ${author}`].filter(Boolean);
  io.err(`\n${s.bold(p.title)}${tags.length > 0 ? `  ${s.dim(tags.join("  "))}` : ""}`);
  if (post) io.err(s.dim(`${formatRef(post)}  版 ${shortVersion(post.version)}（${shortDate(post.date)}）`));
  if (p.src.kind === "settings") io.err(s.dim("settings.json として読み込みました（作者の理由はありません）"));
  io.err(s.dim(`比べる相手: ${p.opts.settingsPath}${p.fileExists ? "" : "（まだありません）"}`));
  const count = (k: string) => p.all.filter((c) => c.mine.kind === k).length;
  io.err(
    `あなたの設定と比べました：持っていない ${count("new")}、値が違う ${count("differs")}、同じ ${count("same")}` +
      (count("same") > 0 ? s.dim("（同じものは出しません）") : ""),
  );
  if (p.skippedBefore > 0) io.err(s.dim(`前回決めた ${p.skippedBefore} 件は出しません（--all で全部出します）`));
}

/** 対話せずに選ぶ */
function selectBatch(cands: PickCandidate[], opts: PickOptions, allIds: string[]): PickState {
  let state = emptyPickState();
  if (opts.only.length > 0) {
    const unknown = opts.only.filter((id) => !allIds.includes(id));
    if (unknown.length > 0) throw new CliError(`投稿にない項目です:\n  ${unknown.join("\n  ")}`);
    for (const c of cands) if (opts.only.includes(c.item.id)) state = decide(state, c.item.id, "in");
    return state;
  }
  for (const c of cands) {
    if (c.risk.level === "low" && c.mine.kind === "new" && !containsMasked(c.item.value)) state = decide(state, c.item.id, "in");
  }
  return state;
}

/** 1 件ずつ出して決めてもらう */
async function timeline(ctx: Context, s: Style, cands: PickCandidate[], notes: Notes): Promise<PickState> {
  const { io } = ctx;
  const ask = io.key ? io.key.bind(io) : async (q: string, keys: string[]) => {
    for (;;) {
      const a = (await io.ask(q)).trim().toLowerCase().slice(0, 1);
      if (keys.includes(a)) return a;
    }
  };
  let state = emptyPickState();
  if (pickView(cands, state).total === 0) {
    io.err("\n新しく決める項目はありません");
    return state;
  }
  for (;;) {
    const v = pickView(cands, state);
    const c = v.current;
    if (!c) {
      io.err(s.bold("\nすべて確認しました"));
      break;
    }
    printCard(ctx, s, c, v.decided + 1, v.total, v.currentIsDeferred);
    const k = await ask(PROMPT, KEYS);
    if (k === "y") state = decide(state, c.item.id, "in");
    else if (k === "n") state = decide(state, c.item.id, "out");
    else if (k === "l") state = deferPick(state, c.item.id);
    else if (k === "z") {
      if (state.log.length === 0) io.err(s.dim("  戻せる決定はありません"));
      state = undoPick(state);
    } else if (k === "?") printDetails(ctx, s, c, notes);
    else if (k === "q") break;
  }
  return state;
}

function printCard(ctx: Context, s: Style, c: PickCandidate, n: number, total: number, deferred: boolean): void {
  const { io } = ctx;
  const rule = `── ${n} / ${total} `;
  io.err(`\n${s.dim(rule + "─".repeat(Math.max(0, 56 - rule.length)))}`);
  io.err(s.cyan(deferred ? "あとで回しにした項目です" : c.attention.reason));
  if (c.why) io.err(`\n${s.bold(indent(`「${c.why}」`, "  "))}\n`);
  io.err(`${riskBadge(c.risk.level, s)} ${s.dim(itemGroup(c.item))}  ${s.bold(itemLabel(c.item))}`);
  const value = itemValueText(c.item);
  if (value !== undefined) io.err(indent(value));
  if (c.risk.level !== "low") {
    for (const m of c.risk.matched.filter((x) => x.level === c.risk.level)) {
      io.err((c.risk.level === "high" ? s.red : s.yellow)(`  ! ${m.reason}`));
    }
  }
  if (c.mine.kind === "new") io.err(s.green("  あなたの settings.json にはありません。もらうと追加されます"));
  else if (c.mine.kind === "differs") {
    io.err(s.yellow("  あなたの今の値と違います。もらうと置き換わります"));
    io.err(s.dim(indent(`あなたの値: ${short(c.mine.value, 200)}`)));
  }
  if (containsMasked(c.item.value)) io.err(s.dim("  マスクされた値を含みます。取り込むときに自分の値を入力するか、この項目を飛ばします"));
  const deps = itemDependencies(c.item);
  if (deps.length > 0) io.err(s.dim(`  参照しているファイル: ${deps.map((d) => d.path).join(", ")}（同梱されません）`));
}

function printDetails(ctx: Context, s: Style, c: PickCandidate, notes: Notes): void {
  const { io } = ctx;
  io.err(s.dim(`\n  項目 ID: ${c.item.id}`));
  const desc = describeItem(c.item);
  if (desc) io.err(indent(`説明: ${desc}`, "  "));
  for (const m of c.risk.matched) io.err(`  ${m.level}: ${m.reason}`);
  if (c.risk.matched.length === 0) io.err("  low: リスクの高いルールに当てはまりません");
  io.err(indent(JSON.stringify(c.item.value, null, 2), "  "));
  const tags = Object.hasOwn(notes, c.item.id) ? notes[c.item.id]?.tags : undefined;
  if (tags && tags.length > 0) io.err(s.dim(`  タグ: ${tags.join(", ")}`));
}
