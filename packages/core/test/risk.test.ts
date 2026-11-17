import { describe, expect, it } from "vitest";
import { assessRisk, decompose, DEFAULT_RISK_RULES, type Item, type RiskRule } from "../src/index.js";
import { loadFixture } from "./helpers.js";

function riskMap(file: string): Record<string, string> {
  return Object.fromEntries(decompose(loadFixture(file)).items.map((i) => [i.id, assessRisk(i).level]));
}

describe("assessRisk", () => {
  it("marks the documented high-risk items", () => {
    const r = riskMap("08-risky.json");
    expect(r['/permissions/allow/{"Bash"}']).toBe("high");
    expect(r['/permissions/allow/{"Bash(*)"}']).toBe("high");
    expect(r["/permissions/defaultMode"]).toBe("high");
    expect(r["/skipDangerousModePermissionPrompt"]).toBe("high");
    expect(r["/env/HTTPS_PROXY"]).toBe("high");
    expect(r["/env/NODE_TLS_REJECT_UNAUTHORIZED"]).toBe("high");
    expect(r["/env/MAX_THINKING_TOKENS"]).toBe("medium");
    expect(r['/permissions/allow/{"Edit"}']).toBe("medium");
    expect(r['/permissions/deny/{"Bash(curl *)"}']).toBe("low");
    expect(r["/alwaysThinkingEnabled"]).toBe("low");
  });

  it("treats all hooks and command settings as high", () => {
    const r = riskMap("03-hooks.json");
    for (const [id, level] of Object.entries(r)) expect(level, id).toBe("high");
    const e = riskMap("04-env-secrets.json");
    expect(e["/apiKeyHelper"]).toBe("high");
    expect(e["/env/ANTHROPIC_BASE_URL"]).toBe("high");
    expect(e["/env/GITHUB_TOKEN"]).toBe("medium");
  });

  it("rates specific allows and additionalDirectories medium, display settings low", () => {
    const r = riskMap("02-permissions.json");
    expect(r['/permissions/allow/{"Bash(npm run test *)"}']).toBe("medium");
    expect(r['/permissions/additionalDirectories/{"../shared-lib"}']).toBe("medium");
    expect(r['/permissions/ask/{"Bash(git push *)"}']).toBe("low");
    expect(r["/model"]).toBe("low");
    const m = riskMap("01-minimal.json");
    expect(Object.values(m).every((l) => l === "low")).toBe(true);
  });

  it("rates unknown keys medium and plugin/MCP enablement medium", () => {
    expect(riskMap("05-unknown-keys.json")["/someFutureSetting"]).toBe("medium");
    const p = riskMap("07-plugins-mcp.json");
    expect(p["/enabledPlugins/formatter@anthropic-tools"]).toBe("medium");
    expect(p['/enabledMcpjsonServers/{"github"}']).toBe("medium");
    expect(p["/enableAllProjectMcpServers"]).toBe("low");
  });

  it("is extensible with custom rules and reports reasons", () => {
    const rules: RiskRule[] = [
      ...DEFAULT_RISK_RULES,
      { id: "no-opus", level: "high", reason: "test", test: (i: Item) => i.id === "/model" && i.value === "opus" },
    ];
    const item = decompose({ model: "opus" }).items[0]!;
    expect(assessRisk(item).level).toBe("low");
    const a = assessRisk(item, rules);
    expect(a.level).toBe("high");
    expect(a.matched[0]?.ruleId).toBe("no-opus");
  });
});
