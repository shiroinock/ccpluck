import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { harness, type Harness } from "./harness.js";

/**
 * GitHub の代わりに手元の bare リポジトリを置き場所にし、API は偽物に差し替える。
 * 秘密らしい値はすべて架空（FAKE を含む）
 */
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" },
  });

const POST = {
  format: "ccpluck-post",
  version: 1,
  settings: {
    model: "opus",
    permissions: { deny: ["Bash(rm -rf *)", "Read(./.env)"] },
  },
  notes: { '/permissions/deny/{"Read(./.env)"}': { why: "秘密を読ませない" } },
  meta: { title: "Python で事故らない設定", os: "macos", tags: ["python", "safety"] },
};
const ENV_ID = '/permissions/deny/{"Read(./.env)"}';

interface Origin {
  bare: string;
  work: string;
  /** 公開済みの投稿を書き換えてコミットし、push する（マージに当たる） */
  commitPost(author: string, name: string, post: unknown, msg?: string): void;
  show(ref: string): string;
}

function origin(): Origin {
  const root = mkdtempSync(join(tmpdir(), "ccpluck-origin-"));
  const bare = join(root, "origin.git");
  const work = join(root, "work");
  git(root, "init", "-q", "--bare", "-b", "main", bare);
  git(root, "clone", "-q", bare, work);
  const o: Origin = {
    bare,
    work,
    commitPost(author, name, post, msg = `publish ${author}/${name}`) {
      mkdirSync(join(work, "posts", author), { recursive: true });
      writeFileSync(join(work, "posts", author, `${name}.json`), `${JSON.stringify(post, null, 2)}\n`);
      git(work, "add", ".");
      git(work, "commit", "-q", "-m", msg);
      git(work, "push", "-q", "origin", "HEAD:main");
    },
    show: (ref) => git(bare, "show", ref),
  };
  writeFileSync(join(work, "ccpluck.json"), "{}\n");
  git(work, "add", ".");
  git(work, "commit", "-q", "-m", "init");
  git(work, "push", "-q", "origin", "HEAD:main");
  return o;
}

interface FakeGitHub {
  fetch: typeof fetch;
  calls: { method: string; url: string; body?: unknown }[];
  openPrs: { head: string; html_url: string }[];
}

function fakeGitHub(login = "kenta"): FakeGitHub {
  const gh: FakeGitHub = {
    calls: [],
    openPrs: [],
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      gh.calls.push({ method, url, ...(body ? { body } : {}) });
      const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
      if (url === "https://api.github.com/user") return json({ login, id: 4242 });
      if (method === "GET" && url.includes("/pulls?")) {
        const head = decodeURIComponent(new URL(url).searchParams.get("head") ?? "").split(":")[1];
        return json(gh.openPrs.filter((p) => p.head === head));
      }
      if (method === "POST" && url.endsWith("/pulls")) {
        const pr = { head: (body as { head: string }).head, html_url: `https://github.com/example-org/claude-settings/pull/${gh.openPrs.length + 1}` };
        gh.openPrs.push(pr);
        return json(pr, 201);
      }
      return json({ message: "Not Found" }, 404);
    }) as typeof fetch,
  };
  return gh;
}

function setup(opts: { interactive?: boolean; login?: string } = {}): { h: Harness; o: Origin; gh: FakeGitHub } {
  const gh = fakeGitHub(opts.login);
  const h = harness({ interactive: opts.interactive ?? false, fetch: gh.fetch });
  h.ctx.env = { GITHUB_TOKEN: "FAKE-token", GIT_CONFIG_NOSYSTEM: "1" };
  const o = origin();
  return { h, o, gh };
}

const add = (h: Harness, o: Origin) => h.cli("remote", "add", "team", "github:example-org/claude-settings", "--git-url", o.bare);

describe("remote", () => {
  it("adds, lists, syncs and removes a GitHub repository", async () => {
    const { h, o } = setup();
    o.commitPost("kenta", "python", POST);
    expect(await add(h, o)).toBe(0);
    expect(h.err()).toContain("置き場所 team（github:example-org/claude-settings）を登録しました：投稿 1 件");
    expect(await add(h, o)).toBe(1);
    expect(h.err()).toContain("すでに登録されています");

    expect(await h.cli("remote", "list")).toBe(0);
    expect(h.out()).toContain("team\tgithub:example-org/claude-settings\tmain");

    o.commitPost("hanako", "rust", POST);
    expect(await h.cli("remote", "sync")).toBe(0);
    expect(h.err()).toContain("team: 投稿 2 件");

    expect(await h.cli("remote", "remove", "team")).toBe(0);
    expect(await h.cli("show", "team:kenta/python")).toBe(1);
  });

  it("rejects bad names and specs", async () => {
    const { h, o } = setup();
    expect(await h.cli("remote", "add", "../x", "github:a/b", "--git-url", o.bare)).toBe(1);
    expect(await h.cli("remote", "add", "team", "example-org/claude-settings")).toBe(1);
    expect(h.err()).toContain("github:<owner>/<repo>");
  });
});

describe("search / show", () => {
  it("finds posts by word, tag, key and sorts by what I am missing", async () => {
    const { h, o } = setup();
    o.commitPost("kenta", "python", POST);
    o.commitPost("hanako", "minimal", { ...POST, settings: { model: "sonnet" }, notes: {}, meta: { title: "最小限", tags: ["minimal"] } });
    await add(h, o);
    h.writeSettings(`${JSON.stringify({ model: "opus" })}\n`);

    expect(await h.cli("search", "--for-me")).toBe(0);
    const out = h.out();
    expect(out.indexOf("team:kenta/python")).toBeLessThan(out.indexOf("team:hanako/minimal"));
    expect(out).toContain("3 項目（理由つき 1）  あなたにない 2");

    h.stdout.length = 0;
    await h.cli("search", "--tag", "safety", "--offline");
    expect(h.out()).toContain("team:kenta/python");
    expect(h.out()).not.toContain("minimal");

    h.stdout.length = 0;
    await h.cli("search", "--key", "Read(./.env)", "--offline");
    expect(h.out()).toContain("team:kenta/python");
    expect(h.out()).not.toContain("minimal");

    h.stdout.length = 0;
    await h.cli("search", "最小", "--offline");
    expect(h.out()).toContain("team:hanako/minimal");
    expect(h.out()).not.toContain("python");
  });

  it("shows a post compared with my settings", async () => {
    const { h, o } = setup();
    o.commitPost("kenta", "python", POST);
    await add(h, o);
    h.writeSettings(`${JSON.stringify({ model: "sonnet", permissions: { deny: ["Bash(rm -rf *)"] } })}\n`);
    expect(await h.cli("show", "team:kenta/python")).toBe(0);
    const out = h.out();
    expect(out).toContain("3 項目：あなたにない 1、値が違う 1、同じ 1");
    expect(out).toContain("「秘密を読ませない」");
    expect(out).toMatch(/team:kenta\/python {2}by kenta {2}版 [0-9a-f]{7}/);
  });

  it("explains that unmerged posts are not visible", async () => {
    const { h, o } = setup();
    await add(h, o);
    expect(await h.cli("show", "team:kenta/nothing")).toBe(1);
    expect(h.err()).toContain("レビュー待ちの投稿は、マージされるまで見えません");
  });
});

describe("pick from a remote and updates", () => {
  it("records the post and version, and reports only new changes later", async () => {
    const { h, o } = setup();
    o.commitPost("kenta", "python", POST);
    await add(h, o);
    h.writeSettings(`${JSON.stringify({ model: "opus" })}\n`);
    const v1 = git(o.bare, "rev-parse", "main").trim();

    expect(await h.cli("pick", "team:kenta/python", "--only", ENV_ID, "--yes")).toBe(0);
    expect(JSON.parse(h.readSettings()!).permissions.deny).toEqual(["Read(./.env)"]);
    h.stdout.length = 0;
    await h.cli("history", "--json");
    const recs = JSON.parse(h.out());
    expect(recs[0].source).toMatchObject({ post: "team:kenta/python", version: v1, author: "kenta" });

    // --only は決定を覚えないので、yes-low で残りを決める（覚える）
    expect(await h.cli("pick", "team:kenta/python", "--yes-low", "--yes")).toBe(0);
    h.stderr.length = 0;
    expect(await h.cli("updates")).toBe(0);
    expect(h.err()).toContain("新しく決める更新はありません");

    // 作者が 1 項目を足して更新した
    o.commitPost("kenta", "python", { ...POST, settings: { ...POST.settings, cleanupPeriodDays: 14 } }, "update");
    h.stdout.length = 0;
    expect(await h.cli("updates")).toBe(0);
    expect(h.out()).toContain("team:kenta/python");
    expect(h.out()).toMatch(new RegExp(`${v1.slice(0, 7)} → [0-9a-f]{7}.*新しく決める項目 1`));

    // 作者が取り下げた
    git(o.work, "rm", "-q", "posts/kenta/python.json");
    git(o.work, "commit", "-q", "-m", "unpublish");
    git(o.work, "push", "-q", "origin", "HEAD:main");
    h.stdout.length = 0;
    await h.cli("updates");
    expect(h.out()).toContain("取り下げられました");
  });
});

describe("publish --to", () => {
  const MINE = { model: "opus", env: { API_KEY: "sk-ant-FAKE-dummy-key-for-tests-only" } };

  it("pushes a masked post to a per-post branch and opens a PR, then updates it", async () => {
    const { h, o, gh } = setup({ interactive: true });
    h.writeSettings(`${JSON.stringify(MINE)}\n`);
    await add(h, o);
    // カードは マスクした値（API_KEY）→ model の順
    h.answers.push("python", "y", "", "y", "精度優先", "Python の設定", "python", "");
    expect(await h.cli("publish", "--to", "team")).toBe(0);
    expect(h.err()).toContain("レビュー待ちです: https://github.com/example-org/claude-settings/pull/1");

    const branch = "ccpluck/publish/kenta/python";
    const pushed = JSON.parse(o.show(`${branch}:posts/kenta/python.json`));
    expect(pushed.settings.env.API_KEY).toBe("<<MASKED:env.API_KEY>>");
    expect(pushed.notes["/model"]).toEqual({ why: "精度優先" });
    expect(o.show(branch)).not.toContain("sk-ant");
    // コミットの作者は noreply アドレス
    expect(git(o.bare, "log", "-1", "--format=%an <%ae>", branch).trim()).toBe("kenta <4242+kenta@users.noreply.github.com>");
    // 公開済みのブランチは変えない
    expect(git(o.bare, "ls-tree", "-r", "--name-only", "main")).not.toContain("posts/kenta");
    const created = gh.calls.find((c) => c.method === "POST")!;
    expect(created.body).toMatchObject({ head: branch, base: "main" });

    // レビュー中に出し直すと、同じ PR が更新される
    // 値が変わった model だけが聞かれ、API_KEY の決定と理由は引き継がれる
    h.answers.push("y", "", "", "", "");
    h.writeSettings(`${JSON.stringify({ ...MINE, model: "sonnet" })}\n`);
    h.stderr.length = 0;
    expect(await h.cli("publish", "--to", "team", "--name", "python")).toBe(0);
    expect(h.err()).toContain("決めた 1 件を引き継ぎます");
    expect(h.err()).toContain("レビュー待ちの PR を更新しました: https://github.com/example-org/claude-settings/pull/1");
    expect(gh.calls.filter((c) => c.method === "POST")).toHaveLength(1);
    expect(JSON.parse(o.show(`${branch}:posts/kenta/python.json`)).settings.model).toBe("sonnet");
  });

  it("updates a merged post, carrying decisions and reasons", async () => {
    const { h, o, gh } = setup({ interactive: true });
    h.writeSettings(`${JSON.stringify(MINE)}\n`);
    await add(h, o);
    h.answers.push("python", "n", "y", "精度優先", "Python の設定", "python", "");
    expect(await h.cli("publish", "--to", "team")).toBe(0);
    // マージされた（squash に当たる）
    o.commitPost("kenta", "python", JSON.parse(o.show("ccpluck/publish/kenta/python:posts/kenta/python.json")), "merge");
    gh.openPrs.length = 0;

    // 新しい項目だけが聞かれる
    h.writeSettings(`${JSON.stringify({ ...MINE, cleanupPeriodDays: 14 })}\n`);
    h.stderr.length = 0;
    h.answers.push("y", "", "", "", "");
    expect(await h.cli("publish", "--update", "team:kenta/python")).toBe(0);
    expect(h.err()).toContain("決めた 2 件を引き継ぎます（理由 1 件）");
    expect(h.err()).toContain("レビュー待ちです: https://github.com/example-org/claude-settings/pull/1");
    const pushed = JSON.parse(o.show("ccpluck/publish/kenta/python:posts/kenta/python.json"));
    expect(pushed.settings).toEqual({ model: "opus", cleanupPeriodDays: 14 });
    expect(pushed.notes["/model"]).toEqual({ why: "精度優先" });

    // 同じ内容なら何も送らない
    o.commitPost("kenta", "python", pushed, "merge 2");
    h.answers.push("", "", "");
    expect(await h.cli("publish", "--update", "team:kenta/python")).toBe(0);
    expect(h.err()).toContain("送るものはありません");
  });

  it("refuses to update someone else's post", async () => {
    const { h, o } = setup({ interactive: true, login: "hanako" });
    o.commitPost("kenta", "python", POST);
    h.writeSettings(`${JSON.stringify(MINE)}\n`);
    await add(h, o);
    expect(await h.cli("publish", "--update", "team:kenta/python")).toBe(1);
    expect(h.err()).toContain("更新できるのは自分（hanako）の投稿だけです");
  });
});
