import { describe, expect, it } from "vitest";
import {
  compose,
  decompose,
  deepEqual,
  encodeItemId,
  getItemValue,
  itemFromId,
  parseItemId,
  pruneEmpty,
  removeItem,
  upsertItem,
  type IdSegment,
  type JsonValue,
  type Settings,
} from "../src/index.js";
import { fixtures, loadFixture } from "./helpers.js";

describe("item id", () => {
  const cases: IdSegment[][] = [
    [{ kind: "key", key: "model" }],
    [
      { kind: "key", key: "permissions" },
      { kind: "key", key: "allow" },
      { kind: "elem", value: "Bash(npm run test *)" },
    ],
    [
      { kind: "key", key: "permissions" },
      { kind: "key", key: "allow" },
      { kind: "elem", value: 'Read(/a/b/{x}"quoted"\\back)' },
    ],
    [
      { kind: "key", key: "env" },
      { kind: "key", key: "a/b~c" },
    ],
    [{ kind: "key", key: "{weird}" }],
    [
      { kind: "key", key: "hooks" },
      { kind: "key", key: "PreToolUse" },
      { kind: "match", field: "matcher", value: "Edit|Write" },
      { kind: "match", field: "command", value: 'echo "}/{" && ~/.claude/x.sh' },
    ],
    [
      { kind: "key", key: "hooks" },
      { kind: "key", key: "Stop" },
      { kind: "match" },
      { kind: "match", field: "prompt", value: "日本語のプロンプト" },
    ],
  ];
  it.each(cases.map((c) => [encodeItemId(c), c] as const))("round trips %s", (id, segs) => {
    expect(parseItemId(id)).toEqual(segs);
  });

  it("uses the documented examples", () => {
    expect(encodeItemId([{ kind: "key", key: "model" }])).toBe("/model");
    expect(
      encodeItemId([
        { kind: "key", key: "permissions" },
        { kind: "key", key: "allow" },
        { kind: "elem", value: "Bash(npm run test *)" },
      ]),
    ).toBe('/permissions/allow/{"Bash(npm run test *)"}');
  });

  it("rejects malformed ids", () => {
    for (const bad of ["model", "/", "//x", '/a/{"x"', "/a/{1bad:\"x\"}", '/a/{"x"}y']) {
      expect(() => parseItemId(bad), bad).toThrow();
    }
  });
});

describe("decompose", () => {
  it("splits each kind of item with stable ids", () => {
    const { items } = decompose(loadFixture("02-permissions.json"));
    const ids = items.map((i) => i.id);
    expect(ids).toContain('/permissions/allow/{"Bash(npm run test *)"}');
    expect(ids).toContain('/permissions/deny/{"Bash(rm -rf *)"}');
    expect(ids).toContain("/permissions/defaultMode");
    expect(ids).toContain('/permissions/additionalDirectories/{"../shared-lib"}');
    expect(ids).toContain("/model");
    expect(items.find((i) => i.id === "/model")?.kind).toBe("scalar");
  });

  it("decomposes hooks per command, keyed by event and matcher", () => {
    const { items } = decompose(loadFixture("03-hooks.json"));
    const hooks = items.filter((i) => i.kind === "hook").map((i) => i.id);
    expect(hooks).toEqual([
      '/hooks/PreToolUse/{matcher:"Bash"}/{command:"~/.claude/hooks/block-dangerous.sh"}',
      `/hooks/PreToolUse/{matcher:"Bash"}/{command:${JSON.stringify("jq -r '.tool_input.command' >> ~/.claude/bash-log.txt")}}`,
      `/hooks/PreToolUse/{matcher:"Edit|Write"}/{command:${JSON.stringify('"$CLAUDE_PROJECT_DIR"/.claude/hooks/check-path.py')}}`,
      `/hooks/PostToolUse/{matcher:"Edit|Write"}/{command:${JSON.stringify("npx prettier --write \"$(jq -r '.tool_input.file_path')\"")}}`,
      '/hooks/Stop/{}/{command:"afplay /System/Library/Sounds/Glass.aiff"}',
      '/hooks/Stop/{}/{prompt:"Check whether all tasks are complete."}',
    ]);
    expect(items.find((i) => i.id === "/statusLine")?.kind).toBe("whole");
  });

  it("keeps unknown keys as single 'other' items and malformed hooks as a whole", () => {
    const { items, warnings } = decompose(loadFixture("05-unknown-keys.json"));
    const byId = new Map(items.map((i) => [i.id, i]));
    expect(byId.get("/someFutureSetting")?.kind).toBe("other");
    expect(byId.get("/someFutureSetting")?.value).toEqual({ nested: { deep: [1, 2, 3] }, flag: true });
    expect(byId.get("/permissions/futurePermissionKey")?.kind).toBe("other");
    expect(byId.get("/hooks/WeirdEvent")?.value).toBe("not-an-array");
    expect(byId.get("/companyAnnouncements")?.kind).toBe("whole");
    expect(warnings.map((w) => w.code)).toContain("malformed-hooks");
  });

  it("does not depend on array order", () => {
    const a = decompose({ permissions: { allow: ["A", "B", "C"] } }).items.map((i) => i.id);
    const b = decompose({ permissions: { allow: ["C", "A", "B"] } }).items.map((i) => i.id);
    expect(new Set(a)).toEqual(new Set(b));
  });

  it("merges duplicates and warns", () => {
    const { items, warnings } = decompose({ permissions: { allow: ["A", "A"] } });
    expect(items).toHaveLength(1);
    expect(warnings[0]?.code).toBe("duplicate-item");
  });

  it("refuses prototype-polluting keys", () => {
    const s = JSON.parse('{"__proto__": {"polluted": true}, "env": {"__proto__": "x"}, "model": "opus"}') as Settings;
    const { items, warnings } = decompose(s);
    expect(items.map((i) => i.id)).toEqual(["/model"]);
    expect(warnings.filter((w) => w.code === "forbidden-key")).toHaveLength(2);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe("round trip: compose(decompose(s)) ≡ s", () => {
  it.each(fixtures)("%s", (_name, settings) => {
    const back = compose(decompose(settings).items);
    // キー順まで含めてバイト一致する（フィクスチャには空コンテナや重複がない）
    expect(JSON.stringify(back)).toBe(JSON.stringify(settings));
  });

  it("is semantically equal modulo empty containers and duplicates", () => {
    const s: Settings = {
      permissions: { allow: [], deny: ["X", "X"] },
      env: {},
      hooks: { Stop: [] },
      model: "opus",
    };
    const back = compose(decompose(s).items);
    expect(back).toEqual({ permissions: { deny: ["X"] }, model: "opus" });
    expect(deepEqual(pruneEmpty(back), pruneEmpty({ permissions: { deny: ["X"] }, model: "opus" }))).toBe(true);
  });

  it("merges hook groups that share a matcher (behaviourally equivalent)", () => {
    const s: Settings = {
      hooks: {
        PreToolUse: [
          { matcher: "Bash", hooks: [{ type: "command", command: "a" }] },
          { matcher: "Bash", hooks: [{ type: "command", command: "b" }] },
        ],
      },
    };
    expect(compose(decompose(s).items)).toEqual({
      hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "a" }, { type: "command", command: "b" }] }] },
    });
  });

  // 簡易ファズ: ランダムな settings を作ってラウンドトリップを確かめる
  it("holds for randomly generated settings", () => {
    let seed = 42;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const pick = <T,>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)] as T;
    const words = ["Bash(ls *)", "Read(./x)", "a/b", "~", "{", "}", '"q"', "日本", "Edit", "x y z"];
    const randStrings = () => [...new Set(Array.from({ length: 1 + Math.floor(rnd() * 4) }, () => pick(words)))];
    const randValue = (depth = 0): JsonValue => {
      const r = rnd();
      if (depth > 2 || r < 0.3) return pick([1, true, null, "s", 0.5]);
      if (r < 0.6) return randStrings();
      const o: Record<string, JsonValue> = {};
      for (const k of randStrings()) o[k] = randValue(depth + 1);
      return o;
    };
    for (let n = 0; n < 200; n++) {
      const s: Settings = {};
      if (rnd() < 0.7) s.permissions = { allow: randStrings(), deny: randStrings(), defaultMode: "plan" };
      if (rnd() < 0.7) s.env = Object.fromEntries(randStrings().map((k) => [k, pick(words)]));
      if (rnd() < 0.7) {
        s.hooks = {
          [pick(["PreToolUse", "Stop"])]: [
            ...new Set(randStrings()),
          ].map((m, i) => ({
            ...(i % 2 ? { matcher: m } : {}),
            hooks: randStrings().map((c) => ({ type: "command", command: c })),
          })),
        };
      }
      s[pick(["model", "unknownKey", "statusLine"])] = randValue();
      const back = compose(decompose(s).items);
      // 同じ matcher のグループは 1 つにまとまるので、項目集合で比べる
      const ids = (x: Settings) =>
        decompose(x)
          .items.map((i) => JSON.stringify([i.id, i.value]))
          .sort();
      expect(ids(back)).toEqual(ids(s));
    }
  });
});

describe("get / upsert / remove", () => {
  const s = loadFixture("03-hooks.json");
  const id = '/hooks/PreToolUse/{matcher:"Bash"}/{command:"~/.claude/hooks/block-dangerous.sh"}';

  it("reads an item by id", () => {
    expect(getItemValue(s, id)).toEqual({ type: "command", command: "~/.claude/hooks/block-dangerous.sh", timeout: 10 });
    expect(getItemValue(s, "/nope")).toBeUndefined();
  });

  it("removes and prunes empty containers without mutating input", () => {
    const before = JSON.stringify(s);
    const out = removeItem(s, '/hooks/PreToolUse/{matcher:"Edit|Write"}/{command:"\\"$CLAUDE_PROJECT_DIR\\"/.claude/hooks/check-path.py"}');
    expect((out.hooks as Record<string, unknown[]>).PreToolUse).toHaveLength(1);
    expect(JSON.stringify(s)).toBe(before);
    const empty = removeItem({ permissions: { allow: ["A"] } }, '/permissions/allow/{"A"}');
    expect(empty).toEqual({});
  });

  it("upserts into an existing group", () => {
    const item = itemFromId('/hooks/PreToolUse/{matcher:"Bash"}/{command:"new.sh"}', { type: "command", command: "new.sh" });
    const out = upsertItem(s, item);
    const groups = (out.hooks as Record<string, { hooks: unknown[] }[]>).PreToolUse!;
    expect(groups[0]!.hooks).toHaveLength(3);
  });

  it("itemFromId rejects values that disagree with the id", () => {
    expect(() => itemFromId('/permissions/allow/{"A"}', "B")).toThrow();
    expect(() => itemFromId('/hooks/Stop/{}/{command:"a"}', { type: "command", command: "rm -rf ~" })).toThrow();
    expect(() => itemFromId("/__proto__/x", 1)).toThrow();
  });
});

describe("withValue", () => {
  it("rebuilds ids that depend on the value", async () => {
    const { withValue } = await import("../src/index.js");
    const [hook] = decompose({ hooks: { Stop: [{ matcher: "x", hooks: [{ type: "command", command: "<<MASKED:a>>" }] }] } }).items;
    const filled = withValue(hook!, { type: "command", command: "say hi" });
    expect(filled.id).toBe('/hooks/Stop/{matcher:"x"}/{command:"say hi"}');
    const [elem] = decompose({ permissions: { allow: ["A"] } }).items;
    expect(withValue(elem!, "B").id).toBe('/permissions/allow/{"B"}');
    const [scalar] = decompose({ model: "a" }).items;
    expect(withValue(scalar!, "b")).toMatchObject({ id: "/model", value: "b" });
  });
});
