import { describe, expect, it } from "vitest";
import {
  containsMasked,
  decompose,
  fillMasked,
  findMaskedLabels,
  maskSettings,
  replaceHomePaths,
  type Settings,
} from "../src/index.js";
import { fixtures, loadFixture } from "./helpers.js";

/** フィクスチャに埋め込んだ架空の「秘密」（形だけ本物に似せた FAKE 値）。マスク後の出力に 1 つも残ってはいけない */
const KNOWN_SECRETS = [
  "ghp_FAKEdummyTOKENforTESTSonly0000000000",
  "sk-ant-FAKE-dummy-key-for-tests-only",
  "FAKE-password",
  "AKIAFAKEFAKEFAKEFAKE",
  "FAKE9fQ2xL7pR4mZ8wK3vN6bT1yH5c",
  "FAKEWEBHOOK", // SLACK_WEBHOOK（env なので丸ごとマスク）
];

const USERNAMES = ["/Users/taro", "/home/jiro", "C:\\Users\\hanako", "C:/Users/hanako"];

describe("maskSettings", () => {
  it.each(fixtures)("leaves no known secret or home username in %s", (_n, s) => {
    const out = JSON.stringify(maskSettings(s).settings);
    for (const secret of KNOWN_SECRETS) expect(out).not.toContain(secret);
    for (const u of USERNAMES) expect(out).not.toContain(u);
    expect(out).not.toMatch(/taro|jiro|hanako/);
  });

  it.each(fixtures)("keeps the structure of %s (same item kinds and keys)", (_n, s) => {
    const masked = maskSettings(s).settings;
    const shape = (x: Settings) =>
      decompose(x).items.map((i) => [i.kind, i.path.join("."), i.hook?.event, i.hook?.matcher]);
    expect(shape(masked)).toEqual(shape(s));
  });

  it("masks every env value by default, keeps public ones on request", () => {
    const s = loadFixture("04-env-secrets.json");
    const all = maskSettings(s).settings.env as Record<string, string>;
    expect(all.GITHUB_TOKEN).toBe("<<MASKED:env.GITHUB_TOKEN>>");
    expect(all.DISABLE_TELEMETRY).toBe("<<MASKED:env.DISABLE_TELEMETRY>>");
    const pub = maskSettings(s, { publicEnvKeys: ["DISABLE_TELEMETRY", "GITHUB_TOKEN"] }).settings.env as Record<
      string,
      string
    >;
    expect(pub.DISABLE_TELEMETRY).toBe("1");
    // 公開を許可しても既知の秘密パターンはマスクする
    expect(pub.GITHUB_TOKEN).toBe("<<MASKED:env.GITHUB_TOKEN>>");
  });

  it("masks only the secret part of a command", () => {
    const s = loadFixture("04-env-secrets.json");
    const { settings, findings } = maskSettings(s);
    const cmd = ((settings.hooks as any).Notification[0].hooks[0].command) as string;
    expect(cmd).toBe(
      "curl -s -H 'Authorization: Bearer <<MASKED:hooks.Notification[0].hooks[0].command>>' https://notify.example.com/push",
    );
    const git = ((settings.hooks as any).SessionStart[0].hooks[0].command) as string;
    expect(git).toBe(
      "git -C ~/work pull https://<<MASKED:hooks.SessionStart[0].hooks[0].command>>@git.example.com/team/app.git",
    );
    expect(findings.some((f) => f.kind === "secret-pattern" && f.reason.includes("URL"))).toBe(true);
  });

  it("masks values whose key name looks secret, in nested objects", () => {
    const s: Settings = {
      extraKnownMarketplaces: { m: { source: { source: "url", url: "https://x", authToken: "abc" } } },
      statusLine: { type: "command", command: "x", headers: { "X-Api-Key": "short" } },
    };
    const out = maskSettings(s).settings as any;
    expect(out.extraKnownMarketplaces.m.source.authToken).toBe("<<MASKED:extraKnownMarketplaces.m.source.authToken>>");
    expect(out.statusLine.headers["X-Api-Key"]).toBe('<<MASKED:statusLine.headers["X-Api-Key"]>>');
    expect(out.statusLine.type).toBe("command");
  });

  it("does not mask known top-level keys by name (apiKeyHelper is a path)", () => {
    const out = maskSettings({ apiKeyHelper: "~/bin/key.sh" }).settings;
    expect(out.apiKeyHelper).toBe("~/bin/key.sh");
  });

  it("catches high-entropy strings but not ordinary rules or paths", () => {
    const out = maskSettings({
      permissions: { allow: ["Bash(npm run test *)", "Read(~/projects/my-app/src/**)"] },
      model: "claude-opus-5-5",
      unknownThing: "FAKEq8Zr2Lm9Xc4Vb7Nn1Kk5Tt3Yy6H",
    }).settings as any;
    expect(out.permissions.allow).toEqual(["Bash(npm run test *)", "Read(~/projects/my-app/src/**)"]);
    expect(out.model).toBe("claude-opus-5-5");
    expect(out.unknownThing).toBe("<<MASKED:unknownThing>>");
  });

  it("replaces home directories on every OS", () => {
    expect(replaceHomePaths("/Users/taro/x").value).toBe("~/x");
    expect(replaceHomePaths("cd /Users/taro && ls").value).toBe("cd ~ && ls");
    expect(replaceHomePaths("/Users/Shared/x").value).toBe("/Users/Shared/x");
    expect(replaceHomePaths("/home/jiro/.claude/a.sh").value).toBe("~/.claude/a.sh");
    expect(replaceHomePaths("C:\\Users\\hanako\\projects\\**").value).toBe("~/projects\\**");
    expect(replaceHomePaths("node C:/Users/hanako/.claude/s.js").value).toBe("node ~/.claude/s.js");
    const w = maskSettings(loadFixture("06-windows.json")).settings as any;
    expect(w.permissions.allow[0]).toBe("Read(~/projects\\**)");
    expect(w.permissions.additionalDirectories).toEqual(["~/Documents\\shared", "D:/work/repo"]);
  });

  it("highlights hosts and repositories without changing them", () => {
    const s = loadFixture("07-plugins-mcp.json");
    s.permissions = { allow: ["WebFetch(domain:wiki.example.internal)"] };
    const { settings, findings } = maskSettings(s);
    expect((settings.permissions as any).allow[0]).toBe("WebFetch(domain:wiki.example.internal)");
    const hints = findings.filter((f) => f.kind === "hint");
    expect(hints.map((h) => h.match)).toEqual(
      expect.arrayContaining(["wiki.example.internal", "domain:wiki.example.internal"]),
    );
    expect(hints.every((h) => h.action === "highlight")).toBe(true);
  });

  it("never mutates the input", () => {
    const s = loadFixture("04-env-secrets.json");
    const before = JSON.stringify(s);
    maskSettings(s);
    expect(JSON.stringify(s)).toBe(before);
  });

  it("is idempotent", () => {
    for (const [, s] of fixtures) {
      const once = maskSettings(s).settings;
      expect(maskSettings(once).settings).toEqual(once);
    }
  });
});

describe("masked values on import", () => {
  it("finds and fills markers", () => {
    const masked = maskSettings(loadFixture("04-env-secrets.json")).settings;
    expect(containsMasked(masked)).toBe(true);
    expect(findMaskedLabels(masked.env!)).toContain("env.GITHUB_TOKEN");
    const filled = fillMasked(masked.env!, { "env.GITHUB_TOKEN": "mine" }) as Record<string, string>;
    expect(filled.GITHUB_TOKEN).toBe("mine");
    expect(filled.DISABLE_TELEMETRY).toBe("<<MASKED:env.DISABLE_TELEMETRY>>");
  });
});
