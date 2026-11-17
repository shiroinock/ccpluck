import { describe, expect, it } from "vitest";
import { parseBundle } from "@ccpick/core";
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

const SECRETS = ["ghp_aB3dE5fG7hI9jK1lM3nO5pQ7rS9tU1vW3xY5", "sk-ant-api03-Zx9Yw8Vu7Ts6Rq5Po4Nm3Lk2Jj1Hh0Gg", "taro"];

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
    expect(rowValueText(hook)).toBe('~/.claude/hooks/block-dangerous.sh\n{"type":"command","timeout":10}');
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
