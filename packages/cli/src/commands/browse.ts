import {
  itemGroup,
  itemLabel,
  itemValueText,
  parsePickSource,
  pickCandidates,
  RANK_ALREADY,
  type PickCandidate,
  type Settings,
} from "@ccpluck/core";
import { formatRef, parseRef, type Backend, type PostEntry } from "../backend.js";
import { CliError, type Context } from "../context.js";
import { readSettingsFile } from "../fsutil.js";
import { PickMemoryStore, valueHash } from "../pick-memory.js";
import { resolvePostInput, shortDate, shortVersion, syncQuietly } from "../post-input.js";
import { openBackend, RemoteStore } from "../remotes.js";
import { indent, makeStyle, riskBadge, type Style } from "../render.js";

interface Common {
  settingsPath: string;
  dataDir: string;
  offline: boolean;
}

/** 登録済みの置き場所を開く（--in があればそれだけ） */
async function backends(ctx: Context, opts: Common & { in?: string }, s: Style): Promise<Backend[]> {
  const f = await new RemoteStore(opts.dataDir).load();
  const names = opts.in ? [opts.in] : Object.keys(f.remotes);
  if (names.length === 0) throw new CliError("登録した置き場所がありません（ccpluck remote add <名前> github:<owner>/<repo>）");
  const out: Backend[] = [];
  for (const n of names) {
    if (!Object.hasOwn(f.remotes, n)) throw new CliError(`置き場所 ${n} は登録されていません`);
    const b = openBackend(ctx, opts.dataDir, n, f.remotes[n]!);
    if (!opts.offline) await syncQuietly(ctx, b, s);
    out.push(b);
  }
  return out;
}

const countBy = (cands: PickCandidate[], k: string) => cands.filter((c) => c.mine.kind === k).length;

// ---------------------------------------------------------------------------
// search

export interface SearchOptions extends Common {
  query?: string;
  in?: string;
  os?: string;
  tags: string[];
  key?: string;
  forMe: boolean;
}

interface Hit {
  entry: PostEntry;
  title: string;
  tags: string[];
  os?: string;
  items: number;
  withWhy: number;
  /** 自分の設定にない項目の数 */
  missing: number;
}

export async function runSearch(ctx: Context, opts: SearchOptions): Promise<number> {
  const s = makeStyle(ctx.io.color);
  const mine = (await readSettingsFile(opts.settingsPath)).settings;
  const q = opts.query?.toLowerCase();
  const hits: Hit[] = [];
  let bad = 0;
  for (const b of await backends(ctx, opts, s)) {
    for (const entry of await b.list()) {
      const post = await b.read(entry.author, entry.name);
      if (!post) continue;
      const src = parsePickSource(post.raw);
      if (src.kind !== "post" || src.errors.length > 0) {
        bad++;
        continue;
      }
      const title = src.meta?.title ?? "";
      const tags = src.meta?.tags ?? [];
      if (q && ![title, entry.author, entry.name, ...tags].some((t) => t.toLowerCase().includes(q))) continue;
      if (opts.os && src.meta?.os !== opts.os) continue;
      if (opts.tags.some((t) => !tags.includes(t))) continue;
      if (opts.key) {
        const k = opts.key;
        if (!src.items.some((i) => i.id.includes(k) || `${itemGroup(i)}:${itemLabel(i)}`.includes(k))) continue;
      }
      const cands = pickCandidates(src.items, src.notes, mine);
      hits.push({
        entry,
        title,
        tags,
        ...(src.meta?.os ? { os: src.meta.os } : {}),
        items: src.items.length,
        withWhy: cands.filter((c) => c.why).length,
        missing: countBy(cands, "new"),
      });
    }
  }
  if (opts.forMe) hits.sort((a, b) => b.missing - a.missing || (a.entry.date < b.entry.date ? 1 : -1));
  if (hits.length === 0) {
    ctx.io.err("当てはまる投稿はありません");
    return 0;
  }
  for (const h of hits) {
    const meta = [h.os, ...h.tags.map((t) => `#${t}`)].filter(Boolean).join(" ");
    ctx.io.out(
      `${s.bold(formatRef(h.entry))}  ${h.title}${meta ? `  ${s.dim(meta)}` : ""}\n` +
        s.dim(`    ${h.items} 項目（理由つき ${h.withWhy}）  あなたにない ${h.missing}  版 ${shortVersion(h.entry.version)} ${shortDate(h.entry.date)}`),
    );
  }
  ctx.io.err(s.dim(`\n${hits.length} 件。読む: ccpluck show <投稿>　もらう: ccpluck pick <投稿>`));
  if (bad > 0) ctx.io.err(s.yellow(`読めない投稿が ${bad} 件ありました`));
  return 0;
}

// ---------------------------------------------------------------------------
// show

export async function runShow(ctx: Context, opts: Common & { input: string }): Promise<number> {
  const s = makeStyle(ctx.io.color);
  const r = await resolvePostInput(ctx, opts.dataDir, opts.input, { offline: opts.offline, style: s });
  const src = parsePickSource(r.raw);
  if (src.errors.length > 0) throw new CliError(`投稿を読めません:\n  ${src.errors.join("\n  ")}`);
  const mine = (await readSettingsFile(opts.settingsPath)).settings;
  const cands = pickCandidates(src.items, src.notes, mine);
  const { io } = ctx;
  const meta = [src.meta?.os, ...(src.meta?.tags ?? []).map((t) => `#${t}`)].filter(Boolean).join(" ");
  io.out(`${s.bold(src.meta?.title ?? src.source?.title ?? opts.input)}${meta ? `  ${s.dim(meta)}` : ""}`);
  if (r.post) io.out(s.dim(`${formatRef(r.post)}  by ${r.post.author}  版 ${shortVersion(r.post.version)}（${shortDate(r.post.date)}）`));
  io.out(
    `${src.items.length} 項目：あなたにない ${countBy(cands, "new")}、値が違う ${countBy(cands, "differs")}、同じ ${countBy(cands, "same")}\n`,
  );
  const mark = (c: PickCandidate) => (c.mine.kind === "new" ? s.green("+") : c.mine.kind === "differs" ? s.yellow("~") : s.dim("="));
  for (const c of cands) {
    io.out(`${mark(c)} ${riskBadge(c.risk.level, s)} ${s.dim(itemGroup(c.item))}  ${c.attention.rank === RANK_ALREADY ? s.dim(itemLabel(c.item)) : s.bold(itemLabel(c.item))}`);
    const v = itemValueText(c.item);
    if (v !== undefined) io.out(s.dim(indent(v, "      ")));
    if (c.why) io.out(indent(`「${c.why}」`, "      "));
  }
  io.err(s.dim(`\n+ あなたにない  ~ 値が違う  = 同じ。もらう: ccpluck pick ${opts.input}`));
  return 0;
}

// ---------------------------------------------------------------------------
// updates

export async function runUpdates(ctx: Context, opts: Common): Promise<number> {
  const s = makeStyle(ctx.io.color);
  const { io } = ctx;
  const remotes = await new RemoteStore(opts.dataDir).load();
  const memories = (await new PickMemoryStore(opts.dataDir).list()).filter((m) => {
    const ref = parseRef(m.sourceKey);
    return ref !== undefined && Object.hasOwn(remotes.remotes, ref.remote);
  });
  if (memories.length === 0) {
    io.err("置き場所から取り込んだ投稿はありません（ccpluck pick <置き場所>:<作者>/<名前>）");
    return 0;
  }
  const mine: Settings = (await readSettingsFile(opts.settingsPath)).settings;
  const opened = new Map<string, Backend>();
  let found = 0;
  for (const m of memories.sort((a, b) => a.sourceKey.localeCompare(b.sourceKey))) {
    const ref = parseRef(m.sourceKey)!;
    let b = opened.get(ref.remote);
    if (!b) {
      b = openBackend(ctx, opts.dataDir, ref.remote, remotes.remotes[ref.remote]!);
      if (!opts.offline) await syncQuietly(ctx, b, s);
      opened.set(ref.remote, b);
    }
    const post = await b.read(ref.author, ref.name);
    if (!post) {
      io.out(`${s.bold(m.sourceKey)}  ${s.dim("取り下げられました（取り込んだ設定はそのままです）")}`);
      found++;
      continue;
    }
    if (m.postVersion === post.version) continue;
    const src = parsePickSource(post.raw);
    if (src.errors.length > 0) continue;
    // 前回決めていない（増えた・値が変わった）項目のうち、自分の設定と違うもの
    const fresh = pickCandidates(src.items, src.notes, mine).filter((c) => {
      if (c.attention.rank === RANK_ALREADY) return false;
      const d = Object.hasOwn(m.decisions, c.item.id) ? m.decisions[c.item.id] : undefined;
      return !d || d.valueHash !== valueHash(c.item.value);
    });
    if (fresh.length === 0) continue;
    found++;
    const withWhy = fresh.filter((c) => c.why).length;
    io.out(
      `${s.bold(m.sourceKey)}  ${src.meta?.title ?? ""}\n` +
        s.dim(
          `    ${m.postVersion ? shortVersion(m.postVersion) : "?"} → ${shortVersion(post.version)}（${shortDate(post.date)}）  ` +
            `新しく決める項目 ${fresh.length}（理由つき ${withWhy}、値が違う ${countBy(fresh, "differs")}）`,
        ),
    );
  }
  if (found === 0) io.err("前に取り込んだ投稿に、新しく決める更新はありません");
  else io.err(s.dim("\n差分だけを選ぶ: ccpluck pick <投稿>"));
  return 0;
}
