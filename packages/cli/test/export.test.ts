import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { harness } from "./harness.js";

const SETTINGS = {
  model: "opus",
  env: { GITHUB_TOKEN: "ghp_FAKEdummyTOKENforTESTSonly0000000000", DISABLE_TELEMETRY: "1" },
  permissions: { allow: ["Read(/Users/taro/notes/**)"], deny: ["Bash(rm -rf *)"] },
  hooks: {
    Stop: [{ hooks: [{ type: "command", command: "curl -H 'Authorization: Bearer sk-ant-FAKE-dummy-key-for-tests-only' https://x.example.com" }] }],
  },
};

describe("export --mask", () => {
  it("requires --mask", async () => {
    const h = harness();
    h.writeSettings(JSON.stringify(SETTINGS));
    expect(await h.cli("export", "--yes")).toBe(1);
    expect(h.err()).toContain("--mask が必須");
  });

  it("requires confirmation when not interactive", async () => {
    const h = harness();
    h.writeSettings(JSON.stringify(SETTINGS));
    expect(await h.cli("export", "--mask")).toBe(1);
    expect(h.out()).toBe("");
  });

  it("writes a masked post with notes re-keyed to masked ids", async () => {
    const h = harness();
    h.writeSettings(JSON.stringify(SETTINGS));
    const notes = h.writeJson("notes.json", {
      version: 1,
      notes: {
        '/permissions/allow/{"Read(/Users/taro/notes/**)"}': { why: "メモを読ませる" },
        '/permissions/deny/{"Bash(rm -rf *)"}': { why: "誤爆防止", tags: ["safety"] },
      },
    });
    expect(
      await h.cli("export", "--mask", "--yes", "--notes", notes, "--public-env", "DISABLE_TELEMETRY", "--tag", "web,safety", "-o", "post.json"),
    ).toBe(0);
    const text = readFileSync(join(h.dir, "post.json"), "utf8");
    expect(text).not.toMatch(/ghp_|sk-ant|taro/);
    const post = JSON.parse(text);
    expect(post.format).toBe("ccpick-post");
    expect(post.meta).toEqual({ license: "CC0-1.0", os: "macos", tags: ["web", "safety"] });
    expect(post.settings.env).toEqual({ GITHUB_TOKEN: "<<MASKED:env.GITHUB_TOKEN>>", DISABLE_TELEMETRY: "1" });
    expect(post.notes).toEqual({
      '/permissions/allow/{"Read(~/notes/**)"}': { why: "メモを読ませる" },
      '/permissions/deny/{"Bash(rm -rf *)"}': { why: "誤爆防止", tags: ["safety"] },
    });
    // 確認画面にマスク結果が出ている
    expect(h.err()).toContain("マスクした値");
    expect(h.err()).toContain("<<MASKED:env.GITHUB_TOKEN>>");
  });

  it("prints to stdout after interactive confirmation", async () => {
    const h = harness({ interactive: true });
    h.writeSettings(JSON.stringify(SETTINGS));
    h.answers.push("y");
    expect(await h.cli("export", "--mask")).toBe(0);
    expect(JSON.parse(h.out()).settings.model).toBe("opus");
  });

  it("round-trips: export then apply on another machine", async () => {
    const src = harness();
    src.writeSettings(JSON.stringify(SETTINGS));
    await src.cli("export", "--mask", "--yes", "-o", "post.json");
    const dst = harness();
    expect(await dst.cli("apply", join(src.dir, "post.json"), "--yes")).toBe(0);
    const s = JSON.parse(dst.readSettings()!);
    // マスク値を含む env と hook は非対話ではスキップされる
    expect(s).toEqual({ model: "opus", permissions: { allow: ["Read(~/notes/**)"], deny: ["Bash(rm -rf *)"] } });
  });
});

describe("cli basics", () => {
  it("prints usage and rejects unknown commands/options", async () => {
    const h = harness();
    expect(await h.cli("--help")).toBe(0);
    expect(h.out()).toContain("ccpick apply");
    expect(await h.cli("frobnicate")).toBe(1);
    expect(await h.cli("apply", "x", "--bogus")).toBe(1);
    expect(h.err()).toContain("エラー");
  });
});
