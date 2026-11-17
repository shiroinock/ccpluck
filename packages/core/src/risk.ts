import type { Item } from "./items.js";

export type RiskLevel = "high" | "medium" | "low";

export interface RiskRule {
  id: string;
  level: RiskLevel;
  reason: string;
  test: (item: Item) => boolean;
}

export interface RiskAssessment {
  level: RiskLevel;
  /** 当てはまったルール（level の高い順） */
  matched: { ruleId: string; level: RiskLevel; reason: string }[];
}

const ORDER: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };

const top = (item: Item) => item.path[0];
const isPerm = (item: Item, key: string) =>
  item.kind === "array-element" && item.path[0] === "permissions" && item.path[1] === key;
const envKey = (item: Item) => (item.kind === "map-entry" && item.path[0] === "env" ? item.path[1] : undefined);

/** 任意のコマンドを実行する設定キー */
export const COMMAND_KEYS = new Set([
  "statusLine",
  "subagentStatusLine",
  "fileSuggestion",
  "apiKeyHelper",
  "awsAuthRefresh",
  "awsCredentialExport",
  "gcpAuthRefresh",
  "otelHeadersHelper",
  "processWrapper",
  "policyHelper",
]);

/** 通信先・認証・TLS を変える環境変数 */
export const HIGH_RISK_ENV =
  /(_BASE_URL$|^(HTTPS?|ALL|NO)_PROXY$|_PROXY_URL$|CA_CERTS?$|^NODE_TLS_REJECT_UNAUTHORIZED$|^OTEL_EXPORTER_OTLP(_\w+)?_ENDPOINT$|_CUSTOM_HEADERS$|_AUTH_TOKEN$|_API_KEY$|^CLAUDE_CODE_USE_(BEDROCK|VERTEX|FOUNDRY)$|^NODE_OPTIONS$|^LD_PRELOAD$|^DYLD_)/i;

/** Bash 全体を許可してしまう allow ルール */
export const BROAD_ALLOW = /^(\*|(Bash|PowerShell)(\((\*|:\*|\s*)\))?)$/;

/**
 * 判定ルールのテーブル。上から順に評価し、当てはまったものの最大レベルを採る。
 * どれにも当てはまらなければ low。
 */
export const DEFAULT_RISK_RULES: RiskRule[] = [
  // --- high
  { id: "hook", level: "high", reason: "hook は任意のコマンドを実行します", test: (i) => i.kind === "hook" },
  {
    id: "hooks-raw",
    level: "high",
    reason: "hook は任意のコマンドを実行します",
    test: (i) => top(i) === "hooks" && i.kind !== "hook",
  },
  {
    id: "command-setting",
    level: "high",
    reason: "このキーは設定したコマンドを実行します",
    test: (i) => COMMAND_KEYS.has(top(i) ?? ""),
  },
  {
    id: "bypass-permissions",
    level: "high",
    reason: "すべての権限確認を省略するモードです",
    test: (i) => i.path[0] === "permissions" && i.path[1] === "defaultMode" && i.value === "bypassPermissions",
  },
  {
    id: "skip-dangerous-prompt",
    level: "high",
    reason: "bypassPermissions の確認ダイアログを省略します",
    test: (i) => top(i) === "skipDangerousModePermissionPrompt" && i.value === true,
  },
  {
    id: "broad-allow",
    level: "high",
    reason: "シェルコマンドを無条件に許可する広すぎるルールです",
    test: (i) => isPerm(i, "allow") && typeof i.value === "string" && BROAD_ALLOW.test(i.value.trim()),
  },
  {
    id: "network-env",
    level: "high",
    reason: "通信先・認証情報・TLS 設定・実行環境を変える環境変数です",
    test: (i) => HIGH_RISK_ENV.test(envKey(i) ?? ""),
  },
  // --- medium
  { id: "allow-rule", level: "medium", reason: "ツールの実行を確認なしで許可します", test: (i) => isPerm(i, "allow") },
  {
    id: "additional-directory",
    level: "medium",
    reason: "Claude がアクセスできるディレクトリを広げます",
    test: (i) => isPerm(i, "additionalDirectories"),
  },
  { id: "env", level: "medium", reason: "環境変数は挙動を広く変えます", test: (i) => envKey(i) !== undefined },
  {
    id: "permissive-mode",
    level: "medium",
    reason: "確認の一部を省略するモードです",
    test: (i) =>
      i.path[0] === "permissions" &&
      i.path[1] === "defaultMode" &&
      typeof i.value === "string" &&
      ["acceptEdits", "dontAsk", "auto"].includes(i.value),
  },
  {
    id: "mcp-plugins",
    level: "medium",
    reason: "MCP サーバーやプラグイン（外部のコード）を有効にします",
    test: (i) =>
      [
        "enableAllProjectMcpServers",
        "enabledMcpjsonServers",
        "enabledPlugins",
        "extraKnownMarketplaces",
        "pluginConfigs",
        "allowedHttpHookUrls",
        "httpHookAllowedEnvVars",
      ].includes(top(i) ?? "") && !(top(i) === "enableAllProjectMcpServers" && i.value === false),
  },
  {
    id: "sandbox",
    level: "medium",
    reason: "サンドボックスの設定を変えます",
    test: (i) => top(i) === "sandbox",
  },
  {
    id: "unknown-key",
    level: "medium",
    reason: "スキーマにないキーです。効果を確認してください",
    test: (i) => i.kind === "other",
  },
];

export function assessRisk(item: Item, rules: RiskRule[] = DEFAULT_RISK_RULES): RiskAssessment {
  const matched = rules
    .filter((r) => {
      try {
        return r.test(item);
      } catch {
        return false;
      }
    })
    .map((r) => ({ ruleId: r.id, level: r.level, reason: r.reason }))
    .sort((a, b) => ORDER[b.level] - ORDER[a.level]);
  return { level: matched[0]?.level ?? "low", matched };
}

export function compareRisk(a: RiskLevel, b: RiskLevel): number {
  return ORDER[a] - ORDER[b];
}
