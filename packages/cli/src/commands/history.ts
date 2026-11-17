import { revertOps, type JournalOp } from "@ccpluck/core";
import { CliError, type Context } from "../context.js";
import { readSettingsFile, sha256, atomicWrite, writeSettings } from "../fsutil.js";
import { makeStyle, short } from "../render.js";
import { Store, type ImportRecord } from "../store.js";

interface Common {
  settingsPath: string;
  dataDir: string;
}

// ---------------------------------------------------------------------------
// history

export async function runHistory(ctx: Context, opts: Common & { id?: string; json: boolean }): Promise<number> {
  const { io } = ctx;
  const s = makeStyle(io.color);
  const store = new Store(opts.dataDir);

  if (opts.id) {
    const rec = await store.load(opts.id);
    if (opts.json) {
      io.out(JSON.stringify(rec, null, 2));
      return 0;
    }
    io.out(`${s.bold(rec.id)}  ${rec.createdAt}  ${statusLabel(rec)}`);
    io.out(`  取り込み元: ${rec.source.title ?? rec.source.input}`);
    if (rec.source.post) io.out(`  投稿: ${rec.source.post}${rec.source.version ? `（版 ${rec.source.version.slice(0, 7)}）` : ""}`);
    io.out(`  対象: ${rec.settingsPath}`);
    for (const op of rec.ops) {
      const done = rec.reverted.includes(op.itemId) ? s.dim(" (revert 済み)") : "";
      const mark = op.op === "add" ? "+" : "~";
      io.out(`  ${mark} ${op.itemId}${done}`);
      if (op.op === "replace") io.out(s.dim(`      ${short(op.before)} → ${short(op.after)}`));
    }
    return 0;
  }

  const recs = (await store.list()).filter((r) => r.settingsPath === opts.settingsPath);
  if (opts.json) {
    io.out(JSON.stringify(recs.map(({ beforeText: _b, ...r }) => r), null, 2));
    return 0;
  }
  if (recs.length === 0) {
    io.err(`${opts.settingsPath} への取り込み履歴はありません`);
    return 0;
  }
  for (const r of recs) {
    const adds = r.ops.filter((o) => o.op === "add").length;
    const reps = r.ops.length - adds;
    io.out(
      `${s.bold(r.id)}  ${r.createdAt.slice(0, 19).replace("T", " ")}  ${statusLabel(r).padEnd(10)}  +${adds} ~${reps}  ${r.source.title ?? r.source.input}${r.source.version ? s.dim(` @${r.source.version.slice(0, 7)}`) : ""}`,
    );
  }
  return 0;
}

function statusLabel(r: ImportRecord): string {
  if (r.status === "undone") return "undone";
  if (r.reverted.length === r.ops.length) return "reverted";
  if (r.reverted.length > 0) return "partial";
  return "applied";
}

// ---------------------------------------------------------------------------
// undo

/**
 * 取り込み単位で戻す。
 * - ファイルが適用直後のまま（sha256 一致）なら、適用前の中身をバイト単位でそのまま書き戻す
 * - その後に変更されていれば、ジャーナルから項目ごとに戻す。手で変更された項目があれば止める
 */
export async function runUndo(ctx: Context, opts: Common & { id: string; force: boolean }): Promise<number> {
  const { io } = ctx;
  const s = makeStyle(io.color);
  const store = new Store(opts.dataDir);
  const rec = await store.load(opts.id);
  if (rec.status === "undone") throw new CliError(`${rec.id} はすでに undo 済みです`);
  if (rec.settingsPath !== opts.settingsPath) {
    throw new CliError(`${rec.id} は ${rec.settingsPath} への取り込みです（--settings-path を合わせてください）`);
  }

  const file = await readSettingsFile(rec.settingsPath);
  if (file.text !== null && sha256(file.text) === rec.afterSha256) {
    await atomicWrite(rec.settingsPath, rec.beforeText);
    io.err(s.green(`${rec.id} を取り消しました（適用前のファイルをそのまま復元）`));
  } else {
    const pending = rec.ops.filter((o) => !rec.reverted.includes(o.itemId));
    const r = revertOps(file.settings, pending);
    if (r.conflicts.length > 0) {
      io.err(s.yellow("適用後に変更された項目があります:"));
      for (const c of r.conflicts) {
        io.err(`  ${c.itemId}\n    適用した値: ${short(c.expected)}\n    いまの値:   ${short(c.actual)}`);
      }
      if (!opts.force) {
        throw new CliError("中止しました。変更されていない項目だけ戻すには --force を付けてください");
      }
    }
    await writeSettings(rec.settingsPath, r.settings, file.format);
    io.err(s.green(`${rec.id} を取り消しました（${r.reverted.length} 項目を戻しました）`));
  }
  rec.status = "undone";
  rec.undoneAt = ctx.now().toISOString();
  rec.reverted = rec.ops.map((o) => o.itemId);
  await store.save(rec);
  return 0;
}

// ---------------------------------------------------------------------------
// revert

/** 項目単位で戻す。最後にその項目を適用した取り込みの操作を取り消す */
export async function runRevert(ctx: Context, opts: Common & { itemId: string; importId?: string }): Promise<number> {
  const { io } = ctx;
  const s = makeStyle(io.color);
  const store = new Store(opts.dataDir);

  const candidates = opts.importId ? [await store.load(opts.importId)] : await store.list();
  let found: { rec: ImportRecord; op: JournalOp } | undefined;
  for (const rec of candidates) {
    if (rec.status !== "applied" || rec.settingsPath !== opts.settingsPath) continue;
    if (rec.reverted.includes(opts.itemId)) continue;
    const op = rec.ops.find((o) => o.itemId === opts.itemId);
    if (op) {
      found = { rec, op };
      break;
    }
  }
  if (!found) throw new CliError(`戻せる取り込みが見つかりません: ${opts.itemId}`);

  const file = await readSettingsFile(opts.settingsPath);
  const r = revertOps(file.settings, [found.op]);
  const c = r.conflicts[0];
  if (c) {
    throw new CliError(
      `${c.itemId} は適用後に変更されているため戻しません\n  適用した値: ${short(c.expected)}\n  いまの値:   ${short(c.actual)}`,
    );
  }
  await writeSettings(opts.settingsPath, r.settings, file.format);
  found.rec.reverted.push(opts.itemId);
  await store.save(found.rec);
  io.err(s.green(`${opts.itemId} を戻しました（取り込み ${found.rec.id}）`));
  return 0;
}
