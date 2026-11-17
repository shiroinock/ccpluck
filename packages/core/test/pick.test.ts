import { describe, expect, it } from "vitest";
import {
  decide,
  deferPick,
  emptyPickState,
  parsePickSource,
  pickCandidates,
  pickView,
  undoPick,
  type PickState,
} from "../src/index.js";

const POST = {
  format: "ccpluck-post",
  version: 1,
  settings: {
    model: "opus",
    cleanupPeriodDays: 14,
    permissions: { deny: ["Bash(rm -rf *)", "Read(./.env)"], allow: ["Bash(npm run test *)"] },
    env: { BASH_DEFAULT_TIMEOUT_MS: "120000" },
  },
  notes: {
    "/model": { why: "精度優先" },
    '/permissions/deny/{"Read(./.env)"}': { why: "秘密を読ませない" },
    "/__proto__": { why: "x" },
  },
  meta: { title: "例", os: "macos", tags: ["web", 1] },
};

const MINE = {
  model: "sonnet",
  permissions: { deny: ["Bash(rm -rf *)"] },
};

describe("parsePickSource", () => {
  it("reads a post with notes and meta", () => {
    const s = parsePickSource(POST);
    expect(s.kind).toBe("post");
    expect(s.errors).toEqual([]);
    expect(s.items.map((i) => i.id)).toContain("/model");
    expect(s.notes["/model"]?.why).toBe("精度優先");
    expect(s.meta).toEqual({ title: "例", os: "macos", tags: ["web"] });
    expect(Object.prototype.hasOwnProperty.call({}, "polluted")).toBe(false);
  });

  it("reads plain settings and bundles", () => {
    expect(parsePickSource({ model: "opus" }).kind).toBe("settings");
    const b = parsePickSource({ format: "ccpluck-bundle", version: 1, items: [{ id: "/model", value: "opus" }], source: { title: "t" } });
    expect(b.kind).toBe("bundle");
    expect(b.source).toEqual({ title: "t" });
  });

  it("reports errors for non-objects", () => {
    expect(parsePickSource([1]).errors.length).toBeGreaterThan(0);
    expect(parsePickSource({ format: "ccpluck-post", settings: 1 }).errors.length).toBeGreaterThan(0);
  });
});

describe("pickCandidates", () => {
  const s = parsePickSource(POST);
  const cands = pickCandidates(s.items, s.notes, MINE);
  const byId = (id: string) => cands.find((c) => c.item.id === id)!;

  it("compares with my settings", () => {
    expect(byId('/permissions/deny/{"Bash(rm -rf *)"}').mine.kind).toBe("same");
    expect(byId("/model").mine).toEqual({ kind: "differs", value: "sonnet" });
    expect(byId("/cleanupPeriodDays").mine.kind).toBe("new");
  });

  it("orders: why+new, new, differs, already last", () => {
    const ids = cands.map((c) => c.item.id);
    expect(ids[0]).toBe('/permissions/deny/{"Read(./.env)"}');
    expect(ids.indexOf("/model")).toBeGreaterThan(ids.indexOf("/cleanupPeriodDays"));
    expect(ids[ids.length - 1]).toBe('/permissions/deny/{"Bash(rm -rf *)"}');
    expect(byId("/model").attention.reason).toContain("値が違います");
  });
});

describe("pick timeline", () => {
  const s = parsePickSource(POST);
  const cands = pickCandidates(s.items, s.notes, MINE);

  it("walks through, defers, undoes and ends", () => {
    let st: PickState = emptyPickState();
    let v = pickView(cands, st);
    expect(v.total).toBe(cands.length - 1);
    expect(v.already).toHaveLength(1);
    const first = v.current!.item.id;

    st = deferPick(st, first);
    v = pickView(cands, st);
    expect(v.current!.item.id).not.toBe(first);

    st = decide(st, v.current!.item.id, "in");
    expect(pickView(cands, st).decided).toBe(1);
    st = undoPick(st);
    expect(pickView(cands, st).decided).toBe(0);

    // 全部決めると、最後にあとで回しのものが出て、それも決めると終わる
    for (;;) {
      v = pickView(cands, st);
      if (!v.current) break;
      if (v.current.item.id === first) expect(v.currentIsDeferred).toBe(true);
      st = decide(st, v.current.item.id, "out");
    }
    expect(v.decided).toBe(v.total);
    expect(undoPick(emptyPickState())).toEqual(emptyPickState());
  });
});
