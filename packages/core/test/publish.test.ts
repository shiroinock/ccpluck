import { describe, expect, it } from "vitest";
import { buildPublishPost, hintsIn, itemFromId, parsePickSource, publishCandidates, verifyMasked } from "../src/index.js";

const MINE = {
  model: "opus",
  permissions: {
    allow: ["Bash", "Read(/Users/taro/notes/**)", "WebFetch(domain:wiki.example.internal)"],
    deny: ["Bash(rm -rf *)"],
  },
  env: { GITHUB_TOKEN: "ghp_FAKEdummyTOKENforTESTSonly0000000000", BASH_DEFAULT_TIMEOUT_MS: "60000" },
};

describe("publishCandidates", () => {
  const plan = publishCandidates(MINE);
  const ids = plan.candidates.map((c) => c.item.id);

  it("masks and orders: masked, high, hints, medium, low", () => {
    const ranks = plan.candidates.map((c) => c.attention.rank);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
    expect(plan.candidates[0]!.hasMasked).toBe(true);
    expect(ids).toContain("/env/GITHUB_TOKEN");
    expect(plan.candidates.find((c) => c.item.id === '/permissions/allow/{"Bash"}')!.attention.rank).toBe(1);
    expect(plan.candidates.find((c) => c.item.id.includes("wiki.example.internal"))!.hints.length).toBeGreaterThan(0);
    expect(ids).toContain('/permissions/allow/{"Read(~/notes/**)"}'); // パスは ~ に置き換わる
    expect(ids[ids.length - 1]).toBe('/permissions/deny/{"Bash(rm -rf *)"}');
    expect(plan.envKeys).toEqual(["GITHUB_TOKEN", "BASH_DEFAULT_TIMEOUT_MS"]);
  });

  it("can make an env value public", () => {
    const p = publishCandidates(MINE, { publicEnvKeys: ["BASH_DEFAULT_TIMEOUT_MS"] });
    expect(p.candidates.find((c) => c.item.id === "/env/BASH_DEFAULT_TIMEOUT_MS")!.item.value).toBe("60000");
  });

  it("builds a post from the chosen items only, with notes on masked IDs", () => {
    const chosen = plan.candidates.filter((c) => c.item.id === "/env/GITHUB_TOKEN" || c.item.id === "/model");
    const post = buildPublishPost(chosen, { "/model": { why: " 精度優先 " }, "/other": { why: "x" } }, { title: "t", os: "macos", tags: [] });
    expect(post.settings).toEqual({ model: "opus", env: { GITHUB_TOKEN: "<<MASKED:env.GITHUB_TOKEN>>" } });
    expect(post.notes).toEqual({ "/model": { why: "精度優先" } });
    expect(post.meta.license).toBe("CC0-1.0");
    expect(verifyMasked(post.settings)).toEqual([]);
    expect(JSON.stringify(post)).not.toContain("ghp_");
    // もらう側でそのまま読める
    expect(parsePickSource(post).items.map((i) => i.id).sort()).toEqual(["/env/GITHUB_TOKEN", "/model"]);
  });
});

describe("hintsIn", () => {
  it("finds internal hosts and repository names", () => {
    expect(hintsIn(itemFromId('/permissions/allow/{"WebFetch(domain:wiki.example.internal)"}', "WebFetch(domain:wiki.example.internal)")).map((h) => h.reason)).toContain("社内ホスト名の可能性");
    expect(hintsIn(itemFromId("/model", "opus"))).toEqual([]);
    // 重なる候補は 1 つにまとめる
    expect(hintsIn(itemFromId('/permissions/allow/{"WebFetch(domain:wiki.example.internal)"}', "WebFetch(domain:wiki.example.internal)"))).toEqual([
      { match: "wiki.example.internal", reason: "社内ホスト名の可能性" },
    ]);
  });
});
