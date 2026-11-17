/** 「サンプルを読み込む」用の設定。秘密らしい値はすべて架空のもの */
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
    "GITHUB_TOKEN": "ghp_aB3dE5fG7hI9jK1lM3nO5pQ7rS9tU1vW3xY5",
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
            "command": "curl -s -H 'Authorization: Bearer sk-ant-api03-Zx9Yw8Vu7Ts6Rq5Po4Nm3Lk2Jj1Hh0Gg' https://notify.example.com/push"
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
