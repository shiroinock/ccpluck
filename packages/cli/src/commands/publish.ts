import { resolve } from "node:path";
import {
  buildPublishPost,
  decide,
  deferPick,
  describeItem,
  itemDependencies,
  itemGroup,
  itemLabel,
  itemValueText,
  parsePickSource,
  pickView,
  publishCandidates,
  undoPick,
  type Notes,
  type PickDecision,
  type PickState,
  type PostMeta,
  type PublishCandidate,
} from "@ccpick/core";
import { CliError, type Context } from "../context.js";
import { atomicWrite, exists, readSettingsFile } from "../fsutil.js";
import { PublishMemoryStore, valueHash, type PublishMemory } from "../pick-memory.js";
import { indent, makeStyle, riskBadge, type Style } from "../render.js";
import { loadJsonInput } from "./apply.js";
import { highlightMarkers, osFromPlatform } from "./export.js";

export interface PublishOptions {
  settingsPath: string;
  dataDir: string;
  /** 書き出し先（既定は --update の投稿、なければ ./ccpick-post.json） */
  output?: string;
  /** 前に書き出した投稿。選択と理由を引き継ぎ、変わったところだけ聞く */
  update?: string;
  /** 値を公開してよい env のキー */
  publicEnv: string[];
  title?: string;
  os?: string;
  tags: string[];
  /** 最後の確認を省略する */
  yes: boolean;
}

const OS_LIST = ["macos", "linux", "windows", "wsl", "other"];

/** 書いた理由（マスク後の項目 ID → 文） */
type Whys = Map<string, string>;

const isEnvItem = (c: PublishCandidate) => c.original.kind === "map-entry" && c.original.path[0] === "env";
const envKey = (c: PublishCandidate) => c.original.path[1] ?? "";

export async function runPublish(ctx: Context, opts: PublishOptions): Promise<number> {
  const { io } = ctx;
  const s = makeStyle(io.color);
  if (!io.interactive) {
    throw new CliError("publish は公開する項目を 1 件ずつ確かめて決めます。端末で実行してください（全部をマスクして書き出すなら ccpick export --mask）");
  }
  const file = await readSettingsFile(opts.settingsPath);
  if (file.text === null) throw new CliError(`${opts.settingsPath} がありません`);

  // 1. 前回の投稿と決定を読む
  const updatePath = opts.update ? resolve(ctx.cwd, opts.update) : undefined;
  const outPath = resolve(ctx.cwd, opts.output ?? opts.update ?? "ccpick-post.json");
  const prev = updatePath ? parsePickSource(await loadJsonInput(ctx, updatePath, "前回の投稿")) : undefined;
  if (prev && (prev.kind !== "post" || prev.errors.length > 0)) {
    throw new CliError(`${updatePath} は ccpick の投稿ではありません${prev.errors.length > 0 ? `: ${prev.errors.join(", ")}` : ""}`);
  }
  const memStore = new PublishMemoryStore(opts.dataDir);
  const memory = updatePath ? await memStore.load(updatePath) : undefined;
  const publicEnv = new Set([...opts.publicEnv, ...(memory?.publicEnv ?? [])]);

  const whys: Whys = new Map();
  for (const [id, n] of Object.entries(prev?.notes ?? {})) if (n.why?.trim()) whys.set(id, n.why.trim());

  let plan = publishCandidates(file.settings, { publicEnvKeys: [...publicEnv] });
  // env の公開を切り替えるとマスクが変わって順位も変わるが、いま見ているカードが入れ替わらないよう最初の順を保つ
  const firstOrder = new Map(plan.candidates.map((c, i) => [c.item.id, i]));
  const keepOrder = (p: typeof plan) => ({
    ...p,
    candidates: [...p.candidates].sort((a, b) => (firstOrder.get(a.item.id) ?? 1e9) - (firstOrder.get(b.item.id) ?? 1e9)),
  });

  // 前回決めた項目（値が同じもの）は聞かない。前回の投稿に入っていたものは「公開する」とみなす
  const prevHash = new Map((prev?.items ?? []).map((i) => [i.id, valueHash(i.value)]));
  const carried = (c: PublishCandidate): PickDecision | undefined => {
    const h = valueHash(c.item.value);
    const m = memory && Object.hasOwn(memory.decisions, c.item.id) ? memory.decisions[c.item.id] : undefined;
    if (m && m.valueHash === h) return m.decision;
    if (prevHash.get(c.item.id) === h) return "in";
    return undefined;
  };
  let state: PickState = { decisions: {}, log: [], deferred: [] };
  for (const c of plan.candidates) {
    const d = carried(c);
    if (d) state.decisions[c.item.id] = d;
  }
  const isCarried = (c: PublishCandidate) => carried(c) !== undefined;
  const shown = () => plan.candidates.filter((c) => !isCarried(c));

  printHeader(ctx, s, { opts, plan, prev, updatePath, carriedCount: plan.candidates.length - shown().length, whys });

  // 2. 1 件ずつ決める
  const ask = io.key ? io.key.bind(io) : async (q: string, keys: string[]) => {
    for (;;) {
      const a = (await io.ask(q)).trim().toLowerCase().slice(0, 1);
      if (keys.includes(a)) return a;
    }
  };
  const askWhy = async (c: PublishCandidate) => {
    const cur = whys.get(c.item.id);
    const a = (await io.ask(cur ? "  理由（Enter でそのまま）: " : "  なぜこう設定したか（投稿に載ります。Enter で省略）: ")).trim();
    if (a) whys.set(c.item.id, a);
  };
  if (shown().length === 0) io.err("\n新しく決める項目はありません");
  for (;;) {
    const list = shown();
    if (list.length === 0) break;
    const v = pickView(list, state);
    const c = v.current;
    if (!c) {
      io.err(s.bold("\nすべて確認しました"));
      break;
    }
    printCard(ctx, s, c, v.decided + 1, v.total, v.currentIsDeferred, whys.get(c.item.id), publicEnv);
    const keys = ["y", "n", "l", "w", ...(io.edit ? ["e"] : []), ...(isEnvItem(c) ? ["v"] : []), "z", "?", "q"];
    const prompt =
      "[y] 公開する  [n] 公開しない  [l] あとで  [w] 理由を書く" +
      (io.edit ? "  [e] エディタで書く" : "") +
      (isEnvItem(c) ? (publicEnv.has(envKey(c)) ? "  [v] 値を隠す" : "  [v] 値を公開する") : "") +
      "  [z] ひとつ戻す  [?] 詳しく  [q] ここで終える > ";
    const k = await ask(prompt, keys);
    if (k === "y") {
      state = decide(state, c.item.id, "in");
      await askWhy(c);
    } else if (k === "n") state = decide(state, c.item.id, "out");
    else if (k === "l") state = deferPick(state, c.item.id);
    else if (k === "w") await askWhy(c);
    else if (k === "e" && io.edit) {
      const text = (await io.edit(whys.get(c.item.id) ?? "")).trim();
      if (text) whys.set(c.item.id, text);
      else whys.delete(c.item.id);
    } else if (k === "v") {
      const key = envKey(c);
      if (publicEnv.has(key)) {
        publicEnv.delete(key);
        io.err(s.dim(`  env.${key} の値を隠します`));
        plan = keepOrder(publishCandidates(file.settings, { publicEnvKeys: [...publicEnv] }));
      } else {
        publicEnv.add(key);
        const next = keepOrder(publishCandidates(file.settings, { publicEnvKeys: [...publicEnv] }));
        if (next.candidates.find((x) => x.item.id === c.item.id)?.hasMasked) {
          // トークンなど秘密のパターンに当たる値は、env の公開を許可してもマスクしたままにする
          publicEnv.delete(key);
          io.err(s.yellow(`  env.${key} の値はトークンなどの秘密に見えるため、公開できません（マスクしたまま公開します）`));
        } else {
          plan = next;
          io.err(s.yellow(`  env.${key} の値を公開します（マスクしません）`));
        }
      }
    } else if (k === "z") {
      if (state.log.length === 0) io.err(s.dim("  戻せる決定はありません"));
      state = undoPick(state);
    } else if (k === "?") printDetails(ctx, s, c);
    else if (k === "q") break;
  }

  // 3. まとめ
  const chosen = plan.candidates.filter((c) => state.decisions[c.item.id] === "in");
  const declined = plan.candidates.filter((c) => state.decisions[c.item.id] === "out");
  const undecided = plan.candidates.length - chosen.length - declined.length;
  const withWhy = chosen.filter((c) => whys.has(c.item.id)).length;
  io.err(
    s.bold(`\n公開する ${chosen.length} 件`) +
      `（理由つき ${withWhy} 件）、公開しない ${declined.length} 件` +
      (undecided > 0 ? s.dim(`、決めていない ${undecided} 件（公開しません）`) : ""),
  );
  if (chosen.length === 0) {
    io.err("公開する項目がありません");
    return 0;
  }
  if (withWhy === 0) io.err(s.dim("理由のある項目は、もらう人の画面で先に出ます。[w] で書き足せます"));

  // 4. タイトル・タグ・OS
  const meta = await askMeta(ctx, opts, prev?.meta);

  // 5. 投稿を作り、全文を見せてから書き出す
  const notes: Notes = {};
  for (const c of chosen) {
    const why = whys.get(c.item.id);
    if (why) Object.defineProperty(notes, c.item.id, { value: { why }, enumerable: true, writable: true, configurable: true });
  }
  let post;
  try {
    post = buildPublishPost(chosen, notes, meta, { publicEnvKeys: [...publicEnv] });
  } catch (e) {
    throw new CliError(`書き出せません: ${(e as Error).message}`);
  }
  const text = `${JSON.stringify(post, null, 2)}\n`;
  io.err(s.bold("\n公開される内容:"));
  io.err(highlightMarkers(text.trimEnd(), s.cyan));
  const hints = chosen.flatMap((c) => c.hints);
  if (hints.length > 0) {
    io.err(s.yellow(`\n確認してほしい箇所が残っています（マスクしていません）:`));
    for (const h of hints) io.err(`  ${s.yellow(h.match)}  ${s.dim(h.reason)}`);
  }
  const already = await exists(outPath);
  if (!opts.yes) {
    const a = (await io.ask(`\n${outPath} に${already ? "上書きして" : ""}書き出しますか? [Y/n] `)).trim().toLowerCase();
    if (a !== "" && a !== "y" && a !== "yes") {
      io.err("中止しました（何も書き出していません）");
      return 1;
    }
  }
  await atomicWrite(outPath, text);

  // 6. 次の --update のために決定を覚える
  const now = ctx.now().toISOString();
  const mem: PublishMemory = { version: 1, outputPath: outPath, updatedAt: now, publicEnv: [...publicEnv].sort(), decisions: {} };
  for (const c of plan.candidates) {
    const d = state.decisions[c.item.id];
    if (!d) continue;
    Object.defineProperty(mem.decisions, c.item.id, {
      value: { decision: d, valueHash: valueHash(c.item.value), at: now },
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  await memStore.save(mem);

  io.err(s.green(`\n書き出しました: ${outPath}`));
  io.err(s.dim(`もらう人は ccpick pick ${outPath} で、欲しい項目だけを取り込めます`));
  io.err(s.dim(`設定を変えたら ccpick publish --update ${outPath} で、変わったところだけ聞きます`));
  return 0;
}

function printHeader(
  ctx: Context,
  s: Style,
  p: {
    opts: PublishOptions;
    plan: ReturnType<typeof publishCandidates>;
    prev: ReturnType<typeof parsePickSource> | undefined;
    updatePath: string | undefined;
    carriedCount: number;
    whys: Whys;
  },
): void {
  const { io } = ctx;
  const f = p.plan.findings;
  io.err(`\n${s.bold(p.opts.settingsPath)} を読みました：${p.plan.candidates.length} 項目`);
  io.err(
    `マスク：値 ${f.filter((x) => x.action === "masked").length} 件、` +
      `パス ${f.filter((x) => x.action === "replaced").length} 件を ~ に置換、` +
      `確認してほしい箇所 ${f.filter((x) => x.action === "highlight").length} 件`,
  );
  if (p.plan.envKeys.length > 0) io.err(s.dim("env の値は既定で非公開です。env のカードで [v] を押すと値を公開できます"));
  if (p.prev && p.updatePath) {
    const ids = new Set(p.plan.candidates.map((c) => c.item.id));
    const gone = p.prev.items.filter((i) => !ids.has(i.id));
    io.err(
      `前回の投稿（${p.updatePath}）から：決めた ${p.carriedCount} 件を引き継ぎます（理由 ${p.whys.size} 件）` +
        (gone.length > 0 ? `。設定からなくなった・値が変わった ${gone.length} 件は投稿から外れます` : ""),
    );
  }
}

function printCard(
  ctx: Context,
  s: Style,
  c: PublishCandidate,
  n: number,
  total: number,
  deferred: boolean,
  why: string | undefined,
  publicEnv: Set<string>,
): void {
  const { io } = ctx;
  const rule = `── ${n} / ${total} `;
  io.err(`\n${s.dim(rule + "─".repeat(Math.max(0, 56 - rule.length)))}`);
  io.err(s.cyan(deferred ? "あとで回しにした項目です" : c.attention.reason));
  io.err(`${riskBadge(c.risk.level, s)} ${s.dim(itemGroup(c.item))}  ${s.bold(itemLabel(c.item))}`);
  const value = itemValueText(c.item);
  if (value !== undefined) io.err(highlightMarkers(indent(value), s.cyan));
  if (c.risk.level !== "low") {
    for (const m of c.risk.matched.filter((x) => x.level === c.risk.level)) {
      io.err((c.risk.level === "high" ? s.red : s.yellow)(`  ! ${m.reason}`));
    }
  }
  if (c.hasMasked) io.err(s.dim("  取り込む人は自分の値を入力するか、この項目を飛ばします"));
  if (isEnvItem(c) && publicEnv.has(envKey(c))) io.err(s.yellow("  この env の値は公開されます"));
  if (c.changedByMask && !c.hasMasked) io.err(s.dim("  パスを ~ に置き換えています"));
  for (const h of c.hints) io.err(`  ${s.yellow(`確認してほしい箇所: ${h.match}`)}  ${s.dim(h.reason)}`);
  const deps = itemDependencies(c.item);
  if (deps.length > 0) io.err(s.dim(`  参照しているファイル: ${deps.map((d) => d.path).join(", ")}（投稿には含まれません）`));
  if (why) io.err(`  理由: ${why}`);
}

function printDetails(ctx: Context, s: Style, c: PublishCandidate): void {
  const { io } = ctx;
  io.err(s.dim(`\n  項目 ID（公開されるもの）: ${c.item.id}`));
  const desc = describeItem(c.original);
  if (desc) io.err(indent(`説明: ${desc}`, "  "));
  for (const m of c.risk.matched) io.err(`  ${m.level}: ${m.reason}`);
  if (c.risk.matched.length === 0) io.err("  low: リスクの高いルールに当てはまりません");
  io.err(s.bold("  公開される値:"));
  io.err(highlightMarkers(indent(JSON.stringify(c.item.value, null, 2), "    "), s.cyan));
}

async function askMeta(ctx: Context, opts: PublishOptions, prev: PostMeta | undefined): Promise<PostMeta> {
  const { io } = ctx;
  const withDefault = (label: string, d: string | undefined) => (d ? `${label}（Enter で「${d}」）: ` : `${label}: `);
  const title = opts.title ?? ((await io.ask(withDefault("\nタイトル", prev?.title))).trim() || prev?.title || "");
  let tags = opts.tags;
  if (tags.length === 0) {
    const d = prev?.tags?.join(", ");
    const a = (await io.ask(withDefault("用途タグ（カンマ区切り。例: web, python, safety）", d))).trim();
    tags = (a || d || "").split(",").map((t) => t.trim()).filter(Boolean);
  }
  const os: string = opts.os ?? prev?.os ?? osFromPlatform(ctx.platform) ?? "other";
  if (!OS_LIST.includes(os)) throw new CliError(`--os は ${OS_LIST.join(" / ")} のどれかです`);
  const meta: PostMeta = { os: os as PostMeta["os"], tags };
  if (title) meta.title = title;
  if (prev?.license) meta.license = prev.license;
  return meta;
}
