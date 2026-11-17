import { resolve } from "node:path";
import { formatRef, parseRef, type Backend, type PostEntry } from "./backend.js";
import { CliError, type Context } from "./context.js";
import { RemoteStore, openBackend } from "./remotes.js";
import { loadJsonInput } from "./commands/apply.js";
import type { Style } from "./render.js";

export interface ResolvedPost {
  raw: unknown;
  /** 2 回目以降の pick で同じ投稿とみなすための参照。標準入力は覚えない */
  sourceKey?: string;
  /** 置き場所の投稿なら、その参照と版 */
  post?: PostEntry;
  backend?: Backend;
  url?: string;
}

/**
 * 投稿の指定を読む。
 * - `<置き場所>:<作者>/<名前>`（登録済みの置き場所の公開済み投稿）
 * - ファイル、https URL、`-`（標準入力）
 */
export async function resolvePostInput(
  ctx: Context,
  dataDir: string,
  input: string,
  opts: { offline: boolean; style: Style; what?: string },
): Promise<ResolvedPost> {
  const ref = parseRef(input);
  if (ref) {
    const cfg = await new RemoteStore(dataDir).get(ref.remote);
    if (cfg) {
      const backend = openBackend(ctx, dataDir, ref.remote, cfg);
      if (!opts.offline) await syncQuietly(ctx, backend, opts.style);
      const post = await backend.read(ref.author, ref.name);
      if (!post) {
        throw new CliError(`${formatRef(ref)} は公開されていません（レビュー待ちの投稿は、マージされるまで見えません。ccpluck search --in ${ref.remote} で一覧）`);
      }
      const { raw, ...entry } = post;
      return { raw, sourceKey: formatRef(ref), post: entry, backend };
    }
  }
  const raw = await loadJsonInput(ctx, input, opts.what ?? "投稿");
  if (input === "-") return { raw };
  if (/^https?:\/\//i.test(input)) return { raw, sourceKey: input.replace(/#.*$/, ""), url: input };
  return { raw, sourceKey: resolve(ctx.cwd, input) };
}

/** 置き場所の最新を取る。取れなければ手元の写しで続ける */
export async function syncQuietly(ctx: Context, backend: Backend, s: Style): Promise<void> {
  try {
    await backend.sync();
  } catch (e) {
    if (!(e instanceof CliError)) throw e;
    ctx.io.err(s.yellow(`警告: ${backend.name} の最新を取れませんでした。手元の写しを使います（${e.message}）`));
  }
}

export const shortVersion = (v: string) => v.slice(0, 7);
export const shortDate = (iso: string) => iso.slice(0, 10);
