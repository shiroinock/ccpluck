/** 「サンプルを読み込む」用の設定。秘密らしい値はすべて架空のもの（FAKE を含む、形だけ本物に似せた値） */
export const SAMPLE = `{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "model": "opus",
  "cleanupPeriodDays": 30,
  "permissions": {
    "allow": [
      "Bash(npm run test *)",
      "Bash(git status)",
      "Read(/Users/taro/notes/**)",
      "WebFetch(domain:wiki.example.internal)",
      "Bash"
    ],
    "deny": ["Bash(rm -rf *)", "Read(./.env)"],
    "ask": ["Bash(git push *)"],
    "defaultMode": "acceptEdits"
  },
  "env": {
    "GITHUB_TOKEN": "ghp_FAKEdummyTOKENforTESTSonly0000000000",
    "BASH_DEFAULT_TIMEOUT_MS": "60000",
    "ANTHROPIC_BASE_URL": "https://llm-proxy.example.internal/v1"
  },
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [{ "type": "command", "command": "~/.claude/hooks/block-dangerous.sh", "timeout": 10 }]
      }
    ],
    "Notification": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "curl -s -H 'Authorization: Bearer sk-ant-FAKE-dummy-key-for-tests-only' https://notify.example.com/push"
          }
        ]
      }
    ]
  },
  "statusLine": { "type": "command", "command": "~/.claude/statusline.sh" },
  "outputStyle": "Explanatory",
  "someFutureSetting": { "enabled": true }
}
`;
