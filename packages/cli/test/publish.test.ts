import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { publishCandidates } from "@ccpick/core";
import { harness, type Harness } from "./harness.js";

/** 秘密らしい値はすべて架空（FAKE を含む） */
const MINE = {
  model: "opus",
  permissions: { allow: ["WebFetch(domain:wiki.example.internal)"], deny: ["Bash(rm -rf *)"] },
  env: { GITHUB_TOKEN: "ghp_FAKEdummyTOKENforTESTSonly0000000000", BASH_DEFAULT_TIMEOUT_MS: "60000" },
  hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "~/.claude/hooks/guard.sh" }] }] },
};

const TOKEN = "/env/GITHUB_TOKEN";
const TIMEOUT = "/env/BASH_DEFAULT_TIMEOUT_MS";
const HOOK = '/hooks/PreToolUse/{matcher:"Bash"}/{command:"~/.claude/hooks/guard.sh"}';
const WEB = '/permissions/allow/{"WebFetch(domain:wiki.example.internal)"}';
const DENY = '/permissions/deny/{"Bash(rm -rf *)"}';
const MODEL = "/model";

function order(settings: object, publicEnv: string[] = []): string[] {
  return publishCandidates(settings as never, { publicEnvKeys: publicEnv }).candidates.map((c) => c.item.id);
}

/** カードの順に、項目ごとの回答（キーと、y のあとの理由など）を並べる */
function script(ids: string[], per: Record<string, string[]>): string[] {
  return ids.flatMap((id) => {
    const a = per[id];
    if (!a) throw new Error(`no answers for ${id}`);
    return a;
  });
}

function setup(settings: object = MINE): Harness {
  const h = harness({ interactive: true });
  h.writeSettings(`${JSON.stringify(settings, null, 2)}\n`);
  return h;
}

const postPath = (h: Harness) => join(h.dir, "ccpick-post.json");
const readPost = (h: Harness) => JSON.parse(readFileSync(postPath(h), "utf8"));

describe("publish", () => {
  it("asks about masked and risky items first, collects reasons and writes a masked post", async () => {
    const h = setup();
    const ids = order(MINE);
    expect(ids[0]).toBe(TOKEN); // マスクした値
    expect(ids.indexOf(HOOK)).toBeLessThan(ids.indexOf(WEB)); // high → 確認してほしい箇所
    expect(ids.indexOf(WEB)).toBeLessThan(ids.indexOf(MODEL));
    h.answers.push(
      ...script(ids, {
        [TOKEN]: ["n"],
        [TIMEOUT]: ["y", "E2E が長いので延ばした"],
        [HOOK]: ["y", ""],
        [WEB]: ["n"],
        [MODEL]: ["y", "精度優先"],
        [DENY]: ["y", "誤爆防止"],
      }),
      "Web の設定", // タイトル
      "web, safety", // タグ
      "", // 最後の確認
    );
    expect(await h.cli("publish")).toBe(0);
    const err = h.err();
    expect(err).toContain("マスク：値 2 件");
    expect(err).toContain("確認してほしい箇所: wiki.example.internal");
    expect(err).toContain("公開する 4 件（理由つき 3 件）、公開しない 2 件");
    const post = readPost(h);
    expect(post.format).toBe("ccpick-post");
    expect(post.settings).toEqual({
      model: "opus",
      permissions: { deny: ["Bash(rm -rf *)"] },
      env: { BASH_DEFAULT_TIMEOUT_MS: "<<MASKED:env.BASH_DEFAULT_TIMEOUT_MS>>" },
      hooks: MINE.hooks,
    });
    expect(post.notes[MODEL]).toEqual({ why: "精度優先" });
    expect(post.notes[HOOK]).toBeUndefined();
    expect(post.meta).toEqual({ os: "macos", tags: ["web", "safety"], title: "Web の設定", license: "CC0-1.0" });
    expect(readFileSync(postPath(h), "utf8")).not.toContain("ghp_");
    expect(readdirSync(join(h.dataDir, "publish"))).toHaveLength(1);
    expect(err).toContain("ccpick pick");
  });

  it("--update carries choices and reasons over and asks only about what changed", async () => {
    const h = setup();
    const ids = order(MINE);
    h.answers.push(
      ...script(ids, { [TOKEN]: ["n"], [TIMEOUT]: ["n"], [HOOK]: ["n"], [WEB]: ["n"], [MODEL]: ["y", "精度優先"], [DENY]: ["y", "誤爆防止"] }),
      "Web の設定",
      "web",
      "",
    );
    expect(await h.cli("publish")).toBe(0);

    // 設定を変えた：model の値が変わり、deny が増えた
    const v2 = { ...MINE, model: "sonnet", permissions: { ...MINE.permissions, deny: ["Bash(rm -rf *)", "Read(./.env)"] } };
    h.writeSettings(`${JSON.stringify(v2, null, 2)}\n`);
    h.questions.length = 0;
    h.stderr.length = 0;
    // 聞かれるのは model と Read(./.env) だけ。タイトルとタグは Enter で前回のまま
    h.answers.push("y", "速さ優先に変えた", "y", "", "", "", "");
    expect(await h.cli("publish", "--update", postPath(h))).toBe(0);
    expect(h.err()).toContain("決めた 5 件を引き継ぎます（理由 2 件）");
    expect(h.questions.filter((q) => q.includes("ここで終える"))).toHaveLength(2);
    const post = readPost(h);
    expect(post.settings.model).toBe("sonnet");
    expect(post.settings.permissions.deny).toEqual(["Bash(rm -rf *)", "Read(./.env)"]);
    expect(post.notes[MODEL]).toEqual({ why: "速さ優先に変えた" });
    expect(post.notes[DENY]).toEqual({ why: "誤爆防止" });
    expect(post.meta.title).toBe("Web の設定");
    expect(post.meta.tags).toEqual(["web"]);

    // 何も変えなければ何も聞かない
    h.questions.length = 0;
    h.answers.push("", "", "");
    expect(await h.cli("publish", "--update", postPath(h))).toBe(0);
    expect(h.questions.filter((q) => q.includes("ここで終える"))).toHaveLength(0);
    expect(h.err()).toContain("新しく決める項目はありません");
  });

  it("[v] makes an env value public, keeps the same card and remembers it", async () => {
    const h = setup();
    const ids = order(MINE);
    h.answers.push(
      ...script(ids, {
        [TOKEN]: ["n"],
        [TIMEOUT]: ["v", "y", ""], // 値を公開してから公開する
        [HOOK]: ["n"],
        [WEB]: ["n"],
        [MODEL]: ["n"],
        [DENY]: ["n"],
      }),
      "",
      "",
      "",
    );
    expect(await h.cli("publish")).toBe(0);
    expect(h.err()).toContain("env.BASH_DEFAULT_TIMEOUT_MS の値を公開します");
    expect(readPost(h).settings).toEqual({ env: { BASH_DEFAULT_TIMEOUT_MS: "60000" } });
    const mem = JSON.parse(readFileSync(join(h.dataDir, "publish", readdirSync(join(h.dataDir, "publish"))[0]!), "utf8"));
    expect(mem.publicEnv).toEqual(["BASH_DEFAULT_TIMEOUT_MS"]);
  });

  it("[v] cannot make a secret-looking env value public", async () => {
    const h = setup();
    const ids = order(MINE);
    expect(ids[0]).toBe(TOKEN);
    h.answers.push("v", "y", "", "q", "", "", "");
    expect(await h.cli("publish")).toBe(0);
    expect(h.err()).toContain("秘密に見えるため、公開できません");
    expect(readPost(h).settings).toEqual({ env: { GITHUB_TOKEN: "<<MASKED:env.GITHUB_TOKEN>>" } });
    expect(readFileSync(postPath(h), "utf8")).not.toContain("ghp_");
    const mem = JSON.parse(readFileSync(join(h.dataDir, "publish", readdirSync(join(h.dataDir, "publish"))[0]!), "utf8"));
    expect(mem.publicEnv).toEqual([]);
  });

  it("writes reasons with the editor ([e]) and can undo ([z]) and quit ([q])", async () => {
    const h = setup();
    h.ctx.io.edit = async (initial) => `${initial}エディタで書いた長い理由\n`;
    const ids = order(MINE);
    h.answers.push(
      "e", // 1 件目（TOKEN）の理由をエディタで書く
      "y", // 公開する
      "", // 理由はそのまま
      "z", // 戻す
      "n", // 公開しない
      "q", // ここで終える
    );
    expect(ids[0]).toBe(TOKEN);
    expect(await h.cli("publish")).toBe(0);
    expect(h.err()).toContain("理由: エディタで書いた長い理由");
    expect(h.err()).toContain("公開する 0 件");
    expect(h.err()).toContain("公開する項目がありません");
    expect(existsSync(postPath(h))).toBe(false);
  });

  it("writes nothing when the final confirmation is declined", async () => {
    const h = setup();
    const ids = order(MINE);
    h.answers.push(...script(ids, { [TOKEN]: ["n"], [TIMEOUT]: ["n"], [HOOK]: ["n"], [WEB]: ["n"], [MODEL]: ["y", ""], [DENY]: ["n"] }), "", "", "n");
    expect(await h.cli("publish", "-o", "out.json")).toBe(1);
    expect(existsSync(join(h.dir, "out.json"))).toBe(false);
    expect(existsSync(join(h.dataDir, "publish"))).toBe(false);
  });

  it("refuses to run without a terminal and when settings.json is missing", async () => {
    const h = harness();
    h.writeSettings("{}");
    expect(await h.cli("publish")).toBe(1);
    expect(h.err()).toContain("端末で実行してください");
    const h2 = harness({ interactive: true });
    expect(await h2.cli("publish")).toBe(1);
    expect(h2.err()).toContain("がありません");
  });

  it("rejects --update with something that is not a post", async () => {
    const h = setup();
    const p = h.writeJson("plain.json", { model: "opus" });
    expect(await h.cli("publish", "--update", p)).toBe(1);
    expect(h.err()).toContain("投稿ではありません");
  });
});
