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

/** 「サンプルの投稿を読み込む」用。誰かが公開画面から書き出した投稿、という想定（架空） */
export const SAMPLE_POST = `{
  "format": "ccpick-post",
  "version": 1,
  "settings": {
    "model": "opus",
    "cleanupPeriodDays": 14,
    "permissions": {
      "allow": ["Bash(npm run test *)", "Bash(npm run lint *)", "Bash(git status)", "Bash(git diff *)"],
      "deny": ["Bash(rm -rf *)", "Read(./.env)", "Read(./.env.*)"],
      "ask": ["Bash(git push *)"]
    },
    "env": {
      "BASH_DEFAULT_TIMEOUT_MS": "120000",
      "GITHUB_TOKEN": "<<MASKED:env.GITHUB_TOKEN>>"
    },
    "hooks": {
      "PostToolUse": [
        {
          "matcher": "Edit|Write",
          "hooks": [{ "type": "command", "command": "npx prettier --write \\"$(jq -r '.tool_input.file_path')\\"" }]
        }
      ]
    },
    "outputStyle": "Explanatory"
  },
  "notes": {
    "/permissions/deny/{\\"Bash(rm -rf *)\\"}": { "why": "一度ビルド成果物ごと消されてから入れている。git 管理外のファイルは戻せないので" },
    "/permissions/deny/{\\"Read(./.env)\\"}": { "why": "秘密がコンテキストに入るのを防ぐ。.env.* も別に塞いでいる" },
    "/permissions/ask/{\\"Bash(git push *)\\"}": { "why": "push だけは毎回自分の目で確かめたい" },
    "/env/BASH_DEFAULT_TIMEOUT_MS": { "why": "E2E テストが 1 分を超えるので 2 分に延ばした" },
    "/model": { "why": "普段は精度優先。急ぐときだけ /model で切り替える" },
    "/hooks/PostToolUse/{matcher:\\"Edit|Write\\"}/{command:\\"npx prettier --write \\\\\\"$(jq -r '.tool_input.file_path')\\\\\\"\\"}": { "why": "編集のたびに整形して、差分のノイズを減らす" }
  },
  "meta": { "title": "Web フロントエンド開発の設定", "os": "macos", "tags": ["web", "typescript", "safety"], "license": "CC0-1.0" }
}
`;
