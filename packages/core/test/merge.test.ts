import { describe, expect, it } from "vitest";
import {
  compose,
  decompose,
  extractReferencedPaths,
  itemFromId,
  mergeItems,
  revertOps,
  rulesOverlap,
  type Item,
  type Settings,
} from "../src/index.js";
import { fixtures, loadFixture } from "./helpers.js";

const items = (s: Settings) => decompose(s).items;
const allIds = (s: Settings) => items(s).map((i) => i.id);

describe("mergeItems", () => {
  it("applying every item onto {} reproduces the settings", () => {
    for (const [name, s] of fixtures) {
      const its = items(s);
      const r = mergeItems({}, its, { confirmedHighRisk: its.map((i) => i.id) });
      expect(r.settings, name).toEqual(compose(its));
      expect(r.applied.every((o) => o.op === "add"), name).toBe(true);
    }
  });

  it("does not mutate the base", () => {
    const base = loadFixture("02-permissions.json");
    const before = JSON.stringify(base);
    mergeItems(base, items({ model: "opus", permissions: { allow: ["X"] } }), { decisions: { "/model": "overwrite" } });
    expect(JSON.stringify(base)).toBe(before);
  });

  describe("scalars", () => {
    const base: Settings = { model: "sonnet" };
    const incoming = items({ model: "opus" });

    it("reports a conflict and skips without a decision", () => {
      const r = mergeItems(base, incoming);
      expect(r.settings.model).toBe("sonnet");
      expect(r.conflicts).toEqual([{ itemId: "/model", existing: "sonnet", incoming: "opus" }]);
      expect(r.skipped[0]?.reason).toBe("conflict-unresolved");
    });

    it("overwrites on request and journals before/after", () => {
      const r = mergeItems(base, incoming, { decisions: { "/model": "overwrite" } });
      expect(r.settings.model).toBe("opus");
      expect(r.applied).toEqual([{ itemId: "/model", op: "replace", before: "sonnet", after: "opus" }]);
    });

    it("skips on request; identical values are 'unchanged'", () => {
      expect(mergeItems(base, incoming, { decisions: { "/model": "skip" } }).skipped[0]?.reason).toBe("conflict-skip");
      expect(mergeItems({ model: "opus" }, incoming).skipped[0]?.reason).toBe("unchanged");
    });

    it("adds when absent", () => {
      const r = mergeItems({}, incoming);
      expect(r.settings).toEqual({ model: "opus" });
      expect(r.applied[0]).toEqual({ itemId: "/model", op: "add", after: "opus" });
    });
  });

  it("unions string arrays, appending after existing entries", () => {
    const base: Settings = { permissions: { allow: ["A", "B"] } };
    const r = mergeItems(base, items({ permissions: { allow: ["C", "A", "D"] } }));
    expect(r.settings).toEqual({ permissions: { allow: ["A", "B", "C", "D"] } });
    expect(r.skipped).toEqual([{ itemId: '/permissions/allow/{"A"}', reason: "unchanged" }]);
  });

  it("merges env per key with conflicts on the same key", () => {
    const base: Settings = { env: { A: "1", B: "2" } };
    const r = mergeItems(base, items({ env: { B: "3", C: "4" } }));
    expect(r.settings).toEqual({ env: { A: "1", B: "2", C: "4" } });
    expect(r.conflicts.map((c) => c.itemId)).toEqual(["/env/B"]);
  });

  describe("hooks", () => {
    const base = loadFixture("03-hooks.json");
    const hookItem = (event: string, matcher: string | undefined, command: string, extra = {}) => {
      const s: Settings = {
        hooks: { [event]: [{ ...(matcher === undefined ? {} : { matcher }), hooks: [{ type: "command", command, ...extra }] }] },
      };
      return items(s)[0] as Item;
    };

    it("appends to the group with the same event and matcher", () => {
      const it = hookItem("PreToolUse", "Bash", "new.sh");
      const r = mergeItems(base, [it], { confirmedHighRisk: [it.id] });
      const groups = (r.settings.hooks as any).PreToolUse;
      expect(groups).toHaveLength(2);
      expect(groups[0].hooks.map((h: any) => h.command)).toEqual([
        "~/.claude/hooks/block-dangerous.sh",
        "jq -r '.tool_input.command' >> ~/.claude/bash-log.txt",
        "new.sh",
      ]);
    });

    it("creates a new group when the matcher is new, and an event when absent", () => {
      const a = hookItem("PreToolUse", "Read", "r.sh");
      const b = hookItem("SessionEnd", undefined, "bye.sh");
      const r = mergeItems(base, [a, b], { confirmedHighRisk: [a.id, b.id] });
      const h = r.settings.hooks as any;
      expect(h.PreToolUse).toHaveLength(3);
      expect(h.PreToolUse[2]).toEqual({ matcher: "Read", hooks: [{ type: "command", command: "r.sh" }] });
      expect(h.SessionEnd).toEqual([{ hooks: [{ type: "command", command: "bye.sh" }] }]);
    });

    it("drops the same command as a duplicate even if other fields differ", () => {
      const it = hookItem("PreToolUse", "Bash", "~/.claude/hooks/block-dangerous.sh", { timeout: 99 });
      const r = mergeItems(base, [it], { confirmedHighRisk: [it.id] });
      expect(r.skipped).toEqual([{ itemId: it.id, reason: "duplicate" }]);
      expect(r.settings).toEqual(base);
    });
  });

  it("refuses high-risk items unless confirmed", () => {
    const its = items(loadFixture("08-risky.json"));
    const r = mergeItems({}, its);
    const refused = r.skipped.filter((s) => s.reason === "needs-confirmation").map((s) => s.itemId);
    expect(refused).toEqual(
      expect.arrayContaining([
        '/permissions/allow/{"Bash"}',
        "/permissions/defaultMode",
        "/env/HTTPS_PROXY",
        "/skipDangerousModePermissionPrompt",
      ]),
    );
    expect((r.settings.permissions as any)?.defaultMode).toBeUndefined();
    expect(r.settings.alwaysThinkingEnabled).toBe(true);
    const ok = mergeItems({}, its, { confirmedHighRisk: refused });
    expect(ok.skipped).toEqual([]);
  });

  it("skips items that still contain masked values", () => {
    const r = mergeItems({}, items({ env: { TOKEN: "<<MASKED:env.TOKEN>>" }, model: "opus" }));
    expect(r.skipped).toEqual([expect.objectContaining({ itemId: "/env/TOKEN", reason: "masked" })]);
    expect(r.settings).toEqual({ model: "opus" });
  });

  it("warns when allow and deny contradict", () => {
    const base: Settings = { permissions: { deny: ["Bash(rm *)"], allow: ["Read"] } };
    const r = mergeItems(base, items({ permissions: { allow: ["Bash(rm -rf /tmp/x)", "Bash(ls)"], deny: ["Read(./.env)"] } }));
    const msgs = r.warnings.filter((w) => w.code === "permission-contradiction").map((w) => w.at);
    expect(msgs).toEqual(['/permissions/allow/{"Bash(rm -rf /tmp/x)"}', '/permissions/deny/{"Read(./.env)"}']);
  });

  it("reports script dependencies of applied hooks and statusLine", () => {
    const its = items(loadFixture("03-hooks.json"));
    const r = mergeItems({}, its, { confirmedHighRisk: its.map((i) => i.id) });
    expect(r.dependencies.map((d) => d.path)).toEqual([
      "~/.claude/hooks/block-dangerous.sh",
      "~/.claude/bash-log.txt",
      "$CLAUDE_PROJECT_DIR/.claude/hooks/check-path.py",
      "~/.claude/statusline.sh",
    ]);
  });

  it("refuses to write through a non-object container", () => {
    const r = mergeItems({ env: "oops" } as Settings, items({ env: { A: "1" } }));
    expect(r.skipped[0]?.reason).toBe("invalid-target");
    expect(r.settings).toEqual({ env: "oops" });
  });
});

describe("rulesOverlap", () => {
  it.each([
    ["Bash", "Bash(rm -rf *)", true],
    ["Bash(*)", "Bash(ls)", true],
    ["Bash(rm *)", "Bash(rm -rf /)", true],
    ["Bash(npm run test:*)", "Bash(npm run test --watch)", true],
    ["Bash(ls)", "Bash(rm)", false],
    ["Read", "Edit", false],
    ["Read(./.env)", "Read(./.env)", true],
  ])("%s vs %s → %s", (a, b, expected) => {
    expect(rulesOverlap(a, b)).toBe(expected);
  });
});

describe("extractReferencedPaths", () => {
  it("finds user scripts and ignores system binaries", () => {
    expect(extractReferencedPaths("python3 /home/jiro/.claude/hooks/inject_context.py").map((d) => d.path)).toEqual([
      "/home/jiro/.claude/hooks/inject_context.py",
    ]);
    expect(extractReferencedPaths("bash $HOME/.claude/statusline.sh")).toEqual([
      { path: "$HOME/.claude/statusline.sh", base: "home" },
    ]);
    expect(extractReferencedPaths("afplay /System/Library/Sounds/Glass.aiff")).toEqual([]);
    expect(extractReferencedPaths("/usr/bin/env node ~/x/y.js")).toEqual([{ path: "~/x/y.js", base: "home" }]);
    expect(extractReferencedPaths("echo hi")).toEqual([]);
  });
});

describe("revertOps", () => {
  const base = loadFixture("02-permissions.json");
  const incoming = items({ model: "opus", permissions: { allow: ["Bash(make *)"] }, env: { X: "1" } });
  const merged = mergeItems(base, incoming, { decisions: { "/model": "overwrite" } });

  it("restores the pre-apply state when untouched", () => {
    const r = revertOps(merged.settings, merged.applied);
    expect(r.conflicts).toEqual([]);
    expect(r.settings).toEqual(base);
  });

  it("reverts a single item and leaves the rest", () => {
    const op = merged.applied.find((o) => o.itemId === "/env/X")!;
    const r = revertOps(merged.settings, [op]);
    expect(r.settings.env).toBeUndefined();
    expect(r.settings.model).toBe("opus");
  });

  it("stops on items changed by hand after applying", () => {
    const edited = { ...merged.settings, model: "haiku" };
    const r = revertOps(edited, merged.applied);
    expect(r.conflicts).toEqual([{ itemId: "/model", expected: "opus", actual: "haiku" }]);
    expect(r.settings.model).toBe("haiku");
    expect(r.reverted).toContain("/env/X");
  });

  it("can revert a hook add", () => {
    const it = itemFromId('/hooks/Stop/{}/{command:"x.sh"}', { type: "command", command: "x.sh" });
    const m = mergeItems({}, [it], { confirmedHighRisk: [it.id] });
    expect(revertOps(m.settings, m.applied).settings).toEqual({});
  });

  it("covers every item of every fixture", () => {
    for (const [name, s] of fixtures) {
      const ids = allIds(s);
      const m = mergeItems({ model: "x" }, items(s), { confirmedHighRisk: ids, decisions: Object.fromEntries(ids.map((i) => [i, "overwrite" as const])) });
      expect(revertOps(m.settings, m.applied).settings, name).toEqual({ model: "x" });
    }
  });
});
