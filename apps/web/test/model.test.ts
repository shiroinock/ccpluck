import { describe, expect, it } from "vitest";
import { parseBundle } from "@ccpluck/core";
import {
  buildBundle,
  buildModel,
  buildPost,
  filterRows,
  highlightSegments,
  parseInput,
  rowLabel,
  rowValueText,
  selectWhere,
  summarize,
} from "../src/model.js";
import { SAMPLE } from "../src/sample.js";

const SECRETS = ["ghp_FAKEdummyTOKENforTESTSonly0000000000", "sk-ant-FAKE-dummy-key-for-tests-only", "taro"];

function sample() {
  const p = parseInput(SAMPLE);
  if (!p.ok) throw new Error(p.error);
  return p.settings;
}

describe("parseInput", () => {
  it("reports the line of a JSON syntax error", () => {
    const r = parseInput('{\n  "model": "opus",\n  oops\n}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/3 行/);
  });

  it("rejects non-objects and broken structures", () => {
    expect(parseInput("[]").ok).toBe(false);
    expect(parseInput('{"permissions": {"allow": "Bash"}}').ok).toBe(false);
    expect(parseInput("   ").ok).toBe(false);
  });

  it("warns about unknown keys but accepts them", () => {
    const r = parseInput(SAMPLE);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.at)).toContain("/someFutureSetting");
  });
});

describe("buildModel", () => {
  it("keeps row keys stable whether masking is on or off", () => {
    const on = buildModel(sample(), { mask: true, publicEnv: [] });
    const off = buildModel(sample(), { mask: false, publicEnv: [] });
    expect(on.rows.map((r) => r.key)).toEqual(off.rows.map((r) => r.key));
    // マスクで ID が変わる項目もある（パスの置換）
    const read = on.rows.find((r) => r.key === '/permissions/allow/{"Read(/Users/taro/notes/**)"}')!;
    expect(read.item.id).toBe('/permissions/allow/{"Read(~/notes/**)"}');
    expect(read.changedByMask).toBe(true);
  });

  it("marks risk, masked values and dependencies", () => {
    const m = buildModel(sample(), { mask: true, publicEnv: [] });
    const by = (k: string) => m.rows.find((r) => r.key === k)!;
    expect(by('/permissions/allow/{"Bash"}').risk.level).toBe("high");
    expect(by("/env/GITHUB_TOKEN").hasMasked).toBe(true);
    expect(by("/model").risk.level).toBe("low");
    const hook = m.rows.find((r) => r.item.kind === "hook" && r.item.hook?.event === "PreToolUse")!;
    expect(hook.deps.map((d) => d.path)).toEqual(["~/.claude/hooks/block-dangerous.sh"]);
    expect(m.envKeys).toEqual(["GITHUB_TOKEN", "BASH_DEFAULT_TIMEOUT_MS", "ANTHROPIC_BASE_URL"]);
  });

  it("publishes only the env values the user allowed", () => {
    const m = buildModel(sample(), { mask: true, publicEnv: ["BASH_DEFAULT_TIMEOUT_MS"] });
    const v = (k: string) => m.rows.find((r) => r.key === k)!.item.value;
    expect(v("/env/BASH_DEFAULT_TIMEOUT_MS")).toBe("60000");
    expect(v("/env/ANTHROPIC_BASE_URL")).toBe("<<MASKED:env.ANTHROPIC_BASE_URL>>");
  });

  it("groups rows for display and labels them", () => {
    const m = buildModel(sample(), { mask: true, publicEnv: [] });
    expect([...new Set(m.rows.map((r) => r.group))]).toEqual([
      "その他の設定",
      "permissions.allow",
      "permissions.deny",
      "permissions.ask",
      "permissions",
      "env",
      "hooks.PreToolUse",
      "hooks.Notification",
      "スキーマにないキー",
    ]);
    const hook = m.rows.find((r) => r.item.kind === "hook")!;
    expect(rowLabel(hook)).toBe("matcher: Bash");
    expect(rowValueText(hook)).toBe('~/.claude/hooks/block-dangerous.sh\n{"timeout":10}');
  });
});

describe("highlightSegments", () => {
  it("splits masked markers and hints", () => {
    const segs = highlightSegments("curl <<MASKED:x>> https://wiki.example.internal/a");
    expect(segs.map((s) => [s.kind, s.text])).toEqual([
      ["plain", "curl "],
      ["masked", "<<MASKED:x>>"],
      ["plain", " https://"],
      ["hint", "wiki.example.internal"],
      ["plain", "/a"],
    ]);
  });
});

describe("filter and selection", () => {
  const m = buildModel(sample(), { mask: true, publicEnv: [] });

  it("filters by risk, text and selection", () => {
    expect(filterRows(m.rows, { risk: "high", query: "", onlySelected: false }, new Set()).every((r) => r.risk.level === "high")).toBe(true);
    expect(filterRows(m.rows, { risk: "all", query: "git push", onlySelected: false }, new Set()).map((r) => r.key)).toEqual([
      '/permissions/ask/{"Bash(git push *)"}',
    ]);
    const sel = new Set(["/model"]);
    expect(filterRows(m.rows, { risk: "all", query: "", onlySelected: true }, sel).map((r) => r.key)).toEqual(["/model"]);
  });

  it("summarizes the selection", () => {
    const sel = new Set(["/model", '/permissions/allow/{"Bash"}', "/env/GITHUB_TOKEN"]);
    expect(summarize(m.rows, sel)).toEqual({ selected: 3, high: 1, masked: 1 });
    expect([...selectWhere(m.rows, (r) => r.risk.level === "low")]).toContain("/model");
  });
});

describe("export", () => {
  it("builds a bundle the CLI accepts, with notes keyed by exported ids", () => {
    const m = buildModel(sample(), { mask: true, publicEnv: [] });
    const sel = new Set(["/model", '/permissions/allow/{"Read(/Users/taro/notes/**)"}']);
    const b = buildBundle(m.rows, sel, { '/permissions/allow/{"Read(/Users/taro/notes/**)"}': "メモを読む", "/cleanupPeriodDays": "選んでいない" });
    const text = JSON.stringify(b);
    for (const s of SECRETS) expect(text).not.toContain(s);
    const parsed = parseBundle(JSON.parse(text));
    expect(parsed.errors).toEqual([]);
    expect(parsed.items.map((i) => i.id)).toEqual(["/model", '/permissions/allow/{"Read(~/notes/**)"}']);
    expect(parsed.notes).toEqual({ '/permissions/allow/{"Read(~/notes/**)"}': { why: "メモを読む" } });
  });

  it("never leaks known secrets even when everything is selected", () => {
    const m = buildModel(sample(), { mask: true, publicEnv: [] });
    const all = new Set(m.rows.map((r) => r.key));
    const bundle = JSON.stringify(buildBundle(m.rows, all, {}));
    const post = JSON.stringify(buildPost(m.rows, all, {}, { os: "macos" }, []));
    for (const s of SECRETS) {
      expect(bundle).not.toContain(s);
      expect(post).not.toContain(s);
    }
  });

  it("refuses to build a post from unmasked settings", () => {
    const m = buildModel(sample(), { mask: false, publicEnv: [] });
    const all = new Set(m.rows.map((r) => r.key));
    expect(() => buildPost(m.rows, all, {}, {}, [])).toThrow(/マスクされていない/);
  });

  it("includes only the selected items in a post", () => {
    const m = buildModel(sample(), { mask: true, publicEnv: [] });
    const post = buildPost(m.rows, new Set(["/model", '/permissions/deny/{"Bash(rm -rf *)"}']), { "/model": "速さ" }, { tags: ["web"] }, []);
    expect(post.settings).toEqual({ model: "opus", permissions: { deny: ["Bash(rm -rf *)"] } });
    expect(post.notes).toEqual({ "/model": { why: "速さ" } });
    expect(post.meta).toEqual({ license: "CC0-1.0", tags: ["web"] });
  });
});

describe("timeline", async () => {
  const { attentionOrder, attentionOf, timelineState } = await import("../src/model.js");
  const m = buildModel(sample(), { mask: true, publicEnv: [] });

  it("orders items by what needs attention first", () => {
    const order = attentionOrder(m.rows);
    const ranks = order.map((r) => attentionOf(r).rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(attentionOf(order[0]!).reason).toBe("マスクした値を含みます");
    expect(order[0]!.key).toBe("/env/GITHUB_TOKEN");
    expect(attentionOf(order[order.length - 1]!).rank).toBe(4);
    // 社内ホスト名を含む medium 項目は、ほかの medium より先に出る
    const hint = order.findIndex((r) => r.key === '/permissions/allow/{"WebFetch(domain:wiki.example.internal)"}');
    const med = order.findIndex((r) => r.key === '/permissions/allow/{"Bash(npm run test *)"}');
    expect(hint).toBeLessThan(med);
  });

  it("walks through items, deferring to the end and allowing decisions from the list", () => {
    const order = attentionOrder(m.rows);
    const [a, b, c] = order.map((r) => r.key);
    const sel = new Set<string>();
    const rej = new Set<string>();

    let s = timelineState(m.rows, sel, rej, [], []);
    expect(s.current?.key).toBe(a);
    expect(s.done).toEqual([]);

    sel.add(a!);
    s = timelineState(m.rows, sel, rej, [a!], [b!]);
    expect(s.current?.key).toBe(c);
    expect(s.deferred.map((r) => r.key)).toEqual([b]);
    expect(s.done.map((d) => [d.row.key, d.decision])).toEqual([[a, "in"]]);

    // 一覧で決めた項目も済みに入る
    rej.add(c!);
    s = timelineState(m.rows, sel, rej, [a!], [b!]);
    expect(s.done.map((d) => d.row.key)).toEqual([c, a]);

    // 残りを全部決めると、あとで回しが最後に出てくる
    for (const r of order) if (r.key !== b && !sel.has(r.key) && !rej.has(r.key)) rej.add(r.key);
    s = timelineState(m.rows, sel, rej, [a!], [b!]);
    expect(s.current?.key).toBe(b);
    expect(s.deferred).toEqual([]);
    expect(s.upcoming).toEqual([]);

    rej.add(b!);
    s = timelineState(m.rows, sel, rej, [a!, b!], []);
    expect(s.current).toBeUndefined();
    expect(s.done).toHaveLength(m.rows.length);
  });
});

describe("pick (他人の設定からもらう)", async () => {
  const { parseSource, compareWithMine, timelineState, attentionOrder, pickAttentionOf } = await import("../src/model.js");
  const { decompose } = await import("@ccpluck/core");

  const POST = JSON.stringify({
    format: "ccpluck-post",
    version: 1,
    settings: {
      model: "opus",
      cleanupPeriodDays: 7,
      permissions: { allow: ["Bash(npm run test *)", "Bash(git status)"], deny: ["Bash(rm -rf *)"] },
      env: { GITHUB_TOKEN: "<<MASKED:env.GITHUB_TOKEN>>" },
    },
    notes: {
      '/permissions/deny/{"Bash(rm -rf *)"}': { why: "誤爆防止" },
      "/model": { why: "精度優先" },
      "/__proto__": { why: "x" },
    },
    meta: { title: "Web 開発用", tags: ["web"], os: "macos", license: "CC0-1.0" },
  });
  const MINE = { model: "sonnet", permissions: { allow: ["Bash(git status)"] } };

  it("reads a post with its notes and meta, and plain settings too", () => {
    const r = parseSource(POST);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.source.isPost).toBe(true);
    expect(r.source.meta).toEqual({ title: "Web 開発用", tags: ["web"], os: "macos", license: "CC0-1.0" });
    expect(r.source.notes["/model"]).toEqual({ why: "精度優先" });
    expect(({} as Record<string, unknown>).why).toBeUndefined();
    const plain = parseSource('{"model":"opus"}');
    expect(plain.ok && plain.source.isPost).toBe(false);
    expect(parseSource("{oops").ok).toBe(false);
  });

  it("compares each item with my settings", () => {
    const items = decompose({ model: "opus", cleanupPeriodDays: 7, permissions: { allow: ["Bash(git status)"] } }).items;
    expect(items.map((i) => compareWithMine(i, MINE).kind)).toEqual(["differs", "new", "same"]);
  });

  it("shows new items with the author's reason first and skips what I already have", () => {
    const r = parseSource(POST);
    if (!r.ok) throw new Error();
    const m = buildModel(r.source.settings, { mask: false, publicEnv: [], mine: MINE, authorNotes: r.source.notes });
    const order = attentionOrder(m.rows, "pick").map((x) => x.key);
    expect(order[0]).toBe('/permissions/deny/{"Bash(rm -rf *)"}');
    expect(pickAttentionOf(m.rows.find((x) => x.key === "/model")!).reason).toBe("あなたの設定と値が違います");
    const t = timelineState(m.rows, new Set(), new Set(), [], [], "pick");
    expect(t.already.map((x) => x.key)).toEqual(['/permissions/allow/{"Bash(git status)"}']);
    expect(t.total).toBe(m.rows.length - 1);
    expect(t.current?.authorWhy).toBe("誤爆防止");
  });

  it("works without my settings (no comparison)", () => {
    const r = parseSource(POST);
    if (!r.ok) throw new Error();
    const m = buildModel(r.source.settings, { mask: false, publicEnv: [], authorNotes: r.source.notes });
    expect(m.rows.every((x) => x.mine === undefined)).toBe(true);
    const t = timelineState(m.rows, new Set(), new Set(), [], [], "pick");
    expect(t.already).toEqual([]);
    expect(t.current?.authorWhy).toBeDefined();
  });
});

describe("sample post", () => {
  it("every note in the sample post points at a real item", async () => {
    const { parseSource } = await import("../src/model.js");
    const { SAMPLE_POST } = await import("../src/sample.js");
    const r = parseSource(SAMPLE_POST);
    if (!r.ok) throw new Error(r.error);
    const m = buildModel(r.source.settings, { mask: false, publicEnv: [], authorNotes: r.source.notes });
    expect(m.rows.filter((x) => x.authorWhy)).toHaveLength(Object.keys(r.source.notes).length);
  });
});
