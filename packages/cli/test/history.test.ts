import { describe, expect, it } from "vitest";
import { bundle, harness, type Harness } from "./harness.js";

const BASE = `{
  "model": "sonnet",
  "permissions": {
    "allow": ["Bash(git status)"]
  }
}
`;

async function applyOk(h: Harness, items: { id: string; value: unknown }[], ...flags: string[]): Promise<string> {
  const code = await h.cli("apply", h.writeJson(`b${Math.random()}.json`, bundle(items)), "--yes", ...flags);
  expect(code, h.err()).toBe(0);
  const ids = [...h.err().matchAll(/importId: (\S+)/g)];
  return ids[ids.length - 1]![1]!;
}

describe("history", () => {
  it("lists imports newest first and shows details", async () => {
    const h = harness();
    h.writeSettings(BASE);
    const a = await applyOk(h, [{ id: "/cleanupPeriodDays", value: 7 }]);
    const b = await applyOk(h, [{ id: "/model", value: "opus" }], "--overwrite");
    expect(await h.cli("history")).toBe(0);
    const lines = h.out().split("\n");
    expect(lines[0]).toContain(b);
    expect(lines[0]).toContain("+0 ~1");
    expect(lines[1]).toContain(a);

    h.stdout.length = 0;
    await h.cli("history", b);
    expect(h.out()).toContain("~ /model");
    expect(h.out()).toContain('"sonnet" → "opus"');
  });

  it("does not include the full before snapshot in the JSON list", async () => {
    const h = harness();
    h.writeSettings(BASE);
    await applyOk(h, [{ id: "/cleanupPeriodDays", value: 7 }]);
    await h.cli("history", "--json");
    expect(JSON.parse(h.out())[0].beforeText).toBeUndefined();
  });

  it("says so when empty", async () => {
    const h = harness();
    expect(await h.cli("history")).toBe(0);
    expect(h.err()).toContain("履歴はありません");
  });
});

describe("undo after later changes", () => {
  it("falls back to item-level revert when the file changed since apply", async () => {
    const h = harness();
    h.writeSettings(BASE);
    const a = await applyOk(h, [
      { id: "/cleanupPeriodDays", value: 7 },
      { id: '/permissions/allow/{"Read"}', value: "Read" },
    ]);
    await applyOk(h, [{ id: "/outputStyle", value: "Explanatory" }]);
    // 古い方を undo しても、新しい取り込みの項目は残る
    expect(await h.cli("undo", a)).toBe(0);
    const s = JSON.parse(h.readSettings()!);
    expect(s.cleanupPeriodDays).toBeUndefined();
    expect(s.permissions.allow).toEqual(["Bash(git status)"]);
    expect(s.outputStyle).toBe("Explanatory");
  });

  it("stops when an applied item was edited by hand, unless --force", async () => {
    const h = harness();
    h.writeSettings(BASE);
    const a = await applyOk(h, [
      { id: "/cleanupPeriodDays", value: 7 },
      { id: "/outputStyle", value: "Explanatory" },
    ]);
    const edited = JSON.parse(h.readSettings()!);
    edited.cleanupPeriodDays = 99;
    h.writeSettings(JSON.stringify(edited, null, 2));
    const before = h.readSettings();

    expect(await h.cli("undo", a)).toBe(1);
    expect(h.err()).toContain("適用後に変更された項目");
    expect(h.readSettings()).toBe(before);

    expect(await h.cli("undo", a, "--force")).toBe(0);
    const s = JSON.parse(h.readSettings()!);
    expect(s.cleanupPeriodDays).toBe(99);
    expect(s.outputStyle).toBeUndefined();
  });

  it("restores bytes exactly after undoing the newer import first", async () => {
    const h = harness();
    h.writeSettings(BASE);
    const a = await applyOk(h, [{ id: "/cleanupPeriodDays", value: 7 }]);
    const b = await applyOk(h, [{ id: "/outputStyle", value: "Explanatory" }]);
    await h.cli("undo", b);
    await h.cli("undo", a);
    expect(h.readSettings()).toBe(BASE);
  });
});

describe("revert", () => {
  it("reverts a single item and keeps the others", async () => {
    const h = harness();
    h.writeSettings(BASE);
    await applyOk(h, [
      { id: "/cleanupPeriodDays", value: 7 },
      { id: '/permissions/allow/{"Read"}', value: "Read" },
    ]);
    expect(await h.cli("revert", '/permissions/allow/{"Read"}')).toBe(0);
    const s = JSON.parse(h.readSettings()!);
    expect(s.permissions.allow).toEqual(["Bash(git status)"]);
    expect(s.cleanupPeriodDays).toBe(7);
    // 2 回目は戻すものがない
    expect(await h.cli("revert", '/permissions/allow/{"Read"}')).toBe(1);
  });

  it("restores the previous value of a replaced item", async () => {
    const h = harness();
    h.writeSettings(BASE);
    await applyOk(h, [{ id: "/model", value: "opus" }], "--overwrite");
    expect(await h.cli("revert", "/model")).toBe(0);
    expect(JSON.parse(h.readSettings()!).model).toBe("sonnet");
  });

  it("stops when the item was changed by hand", async () => {
    const h = harness();
    h.writeSettings(BASE);
    await applyOk(h, [{ id: "/cleanupPeriodDays", value: 7 }]);
    const edited = JSON.parse(h.readSettings()!);
    edited.cleanupPeriodDays = 30;
    h.writeSettings(JSON.stringify(edited));
    expect(await h.cli("revert", "/cleanupPeriodDays")).toBe(1);
    expect(h.err()).toContain("適用後に変更されている");
    expect(JSON.parse(h.readSettings()!).cleanupPeriodDays).toBe(30);
  });

  it("then undo of the same import skips the reverted item", async () => {
    const h = harness();
    h.writeSettings(BASE);
    const a = await applyOk(h, [
      { id: "/cleanupPeriodDays", value: 7 },
      { id: "/outputStyle", value: "Explanatory" },
    ]);
    await h.cli("revert", "/cleanupPeriodDays");
    expect(await h.cli("undo", a)).toBe(0);
    expect(JSON.parse(h.readSettings()!)).toEqual(JSON.parse(BASE));
    h.stdout.length = 0;
    await h.cli("history");
    expect(h.out()).toContain("undone");
  });
});
