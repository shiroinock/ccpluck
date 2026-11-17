import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parsePickSource, pickCandidates } from "@ccpick/core";
import { harness, type Harness } from "./harness.js";

const HOOK_ID = '/hooks/PostToolUse/{matcher:"Edit|Write"}/{command:"npx prettier --write ."}';
const ENV_ID = '/permissions/deny/{"Read(./.env)"}';

function post(settings: Record<string, unknown>, notes: Record<string, { why: string }> = {}) {
  return { format: "ccpick-post", version: 1, settings, notes, meta: { title: "Web の設定", os: "macos", tags: ["web"] } };
}

const SETTINGS_V1 = {
  model: "opus",
  cleanupPeriodDays: 14,
  permissions: { deny: ["Bash(rm -rf *)", "Read(./.env)"] },
  hooks: { PostToolUse: [{ matcher: "Edit|Write", hooks: [{ type: "command", command: "npx prettier --write ." }] }] },
};
const NOTES = { [ENV_ID]: { why: "秘密を読ませない" }, "/model": { why: "精度優先" } };
const MINE = `{\n  "model": "sonnet",\n  "permissions": { "deny": ["Bash(rm -rf *)"] }\n}\n`;

/** タイムラインに出る順（core と同じ並べ方） */
function order(p: ReturnType<typeof post>, mine: string): string[] {
  const s = parsePickSource(p);
  return pickCandidates(s.items, s.notes, JSON.parse(mine))
    .filter((c) => c.mine.kind !== "same")
    .map((c) => c.item.id);
}

function answersFor(ids: string[], choice: Record<string, string>): string[] {
  return ids.map((id) => {
    const a = choice[id];
    if (!a) throw new Error(`no answer for ${id}`);
    return a;
  });
}

function setup(): { h: Harness; postPath: string } {
  const h = harness({ interactive: true });
  h.writeSettings(MINE);
  const postPath = h.writeJson("post.json", post(SETTINGS_V1, NOTES));
  return { h, postPath };
}

describe("pick: interactive", () => {
  it("shows the missing items with the author's why first, then applies the chosen ones", async () => {
    const { h, postPath } = setup();
    const ids = order(post(SETTINGS_V1, NOTES), MINE);
    expect(ids[0]).toBe(ENV_ID); // 理由があり、持っていない
    expect(ids[ids.length - 1]).toBe("/model"); // 値が違う（置き換え）は後ろ
    h.answers.push(
      ...answersFor(ids, { [ENV_ID]: "y", [HOOK_ID]: "y", "/cleanupPeriodDays": "n", "/model": "y" }),
      "yes", // high（hook）の確認
      "", // 最後の確認（Enter で適用）
    );
    expect(await h.cli("pick", postPath)).toBe(0);
    const err = h.err();
    expect(err).toContain("持っていない 3、値が違う 1、同じ 1");
    expect(err).toContain("「秘密を読ませない」");
    expect(err).toContain("あなたの今の値と違います。もらうと置き換わります");
    expect(err).toContain("もらう 3 件（high 1、置き換え 1）、もらわない 1 件");
    expect(h.questions.some((q) => q.includes("上書きしますか"))).toBe(false); // カードで決めたので聞き直さない
    const after = JSON.parse(h.readSettings()!);
    expect(after.model).toBe("opus");
    expect(after.permissions.deny).toEqual(["Bash(rm -rf *)", "Read(./.env)"]);
    expect(after.hooks.PostToolUse[0].hooks[0].command).toBe("npx prettier --write .");
    expect(after.cleanupPeriodDays).toBeUndefined();
    expect(err).toMatch(/importId: \S+/);
    expect(readdirSync(join(h.dataDir, "picks"))).toHaveLength(1);
  });

  it("asks only about new or changed items the second time", async () => {
    const { h, postPath } = setup();
    const ids = order(post(SETTINGS_V1, NOTES), MINE);
    h.answers.push(...answersFor(ids, { [ENV_ID]: "y", [HOOK_ID]: "n", "/cleanupPeriodDays": "n", "/model": "n" }), "");
    expect(await h.cli("pick", postPath)).toBe(0);

    // 投稿が更新された：cleanupPeriodDays の値が変わり、allow が増えた
    const v2 = { ...SETTINGS_V1, cleanupPeriodDays: 7, permissions: { ...SETTINGS_V1.permissions, allow: ["Bash(git status)"] } };
    writeFileSync(postPath, JSON.stringify(post(v2, NOTES)));
    h.questions.length = 0;
    h.stderr.length = 0;
    h.answers.push("n", "n");
    expect(await h.cli("pick", postPath)).toBe(0);
    expect(h.questions).toHaveLength(2);
    expect(h.err()).toContain("前回決めた 3 件は出しません");
    expect(h.err()).toContain("cleanupPeriodDays");
    expect(h.err()).toContain("Bash(git status)");
    expect(h.err()).toContain("取り込む項目はありません");

    // 3 回目は何も聞かない。--all なら全部出る
    h.questions.length = 0;
    expect(await h.cli("pick", postPath)).toBe(0);
    expect(h.questions).toHaveLength(0);
    expect(h.err()).toContain("新しく決める項目はありません");
    h.answers.push("q");
    expect(await h.cli("pick", postPath, "--all")).toBe(0);
    expect(h.questions).toHaveLength(1);
  });

  it("supports undo (z), later (l) and quitting (q)", async () => {
    const { h, postPath } = setup();
    const ids = order(post(SETTINGS_V1, NOTES), MINE);
    // 1 件目をあとで → 2 件目をもらう → z で戻す → 2 件目をもらわない → q で終える → 最後の確認なし（もらう 0 件）
    h.answers.push("z", "l", "y", "z", "n", "q");
    expect(await h.cli("pick", postPath)).toBe(0);
    const err = h.err();
    expect(err).toContain("戻せる決定はありません");
    expect(err).toContain(`もらう 0 件、もらわない 1 件`);
    expect(err).toContain("決めていない 3 件");
    expect(err).toContain("取り込む項目はありません");
    expect(h.readSettings()).toBe(MINE);
    // 2 件目のカードは z の後にもう一度出ている
    const second = ids[1]!;
    expect(err.split(second.includes("Bash") ? "Bash" : "cleanupPeriodDays").length).toBeGreaterThan(2);
  });

  it("writes nothing and remembers nothing when the final confirmation is declined", async () => {
    const { h, postPath } = setup();
    const ids = order(post(SETTINGS_V1, NOTES), MINE);
    h.answers.push(...answersFor(ids, { [ENV_ID]: "y", [HOOK_ID]: "n", "/cleanupPeriodDays": "n", "/model": "n" }), "n");
    expect(await h.cli("pick", postPath)).toBe(1);
    expect(h.readSettings()).toBe(MINE);
    expect(existsSync(join(h.dataDir, "picks"))).toBe(false);
    expect(existsSync(join(h.dataDir, "imports"))).toBe(false);
  });

  it("refuses stdin as the source when choosing interactively", async () => {
    const { h } = setup();
    expect(await h.cli("pick", "-")).toBe(1);
    expect(h.err()).toContain("標準入力から読めません");
  });

  it("reads a plain settings.json as the source", async () => {
    const { h } = setup();
    const p = h.writeJson("theirs.json", { cleanupPeriodDays: 3 });
    h.answers.push("y", "");
    expect(await h.cli("pick", p)).toBe(0);
    expect(h.err()).toContain("settings.json として読み込みました");
    expect(JSON.parse(h.readSettings()!).cleanupPeriodDays).toBe(3);
  });
});

describe("pick: non-interactive", () => {
  function batch() {
    const h = harness();
    h.writeSettings(MINE);
    const postPath = h.writeJson("post.json", post(SETTINGS_V1, NOTES));
    return { h, postPath };
  }

  it("requires --only or --yes-low", async () => {
    const { h, postPath } = batch();
    expect(await h.cli("pick", postPath)).toBe(1);
    expect(h.err()).toContain("--only");
    expect(h.readSettings()).toBe(MINE);
  });

  it("--yes-low takes only low-risk items I do not have", async () => {
    const { h, postPath } = batch();
    expect(await h.cli("pick", postPath, "--yes-low", "--yes")).toBe(0);
    const after = JSON.parse(h.readSettings()!);
    expect(after.cleanupPeriodDays).toBe(14);
    expect(after.permissions.deny).toContain("Read(./.env)");
    expect(after.model).toBe("sonnet"); // 値が違うものは入れない
    expect(after.hooks).toBeUndefined(); // high は入れない
  });

  it("--only still needs --allow-high for high-risk items", async () => {
    const { h, postPath } = batch();
    expect(await h.cli("pick", postPath, "--only", HOOK_ID, "--yes")).toBe(0);
    expect(h.err()).toContain("非対話のため適用しません");
    expect(JSON.parse(h.readSettings()!).hooks).toBeUndefined();
    expect(await h.cli("pick", postPath, "--only", HOOK_ID, "--yes", "--allow-high", HOOK_ID)).toBe(0);
    expect(JSON.parse(h.readSettings()!).hooks).toBeDefined();
  });

  it("rejects unknown item IDs", async () => {
    const { h, postPath } = batch();
    expect(await h.cli("pick", postPath, "--only", "/nope", "--yes")).toBe(1);
    expect(h.err()).toContain("投稿にない項目です");
  });

  it("--dry-run writes nothing", async () => {
    const { h, postPath } = batch();
    expect(await h.cli("pick", postPath, "--yes-low", "--dry-run")).toBe(0);
    expect(h.readSettings()).toBe(MINE);
    expect(existsSync(join(h.dataDir, "picks"))).toBe(false);
  });
});
