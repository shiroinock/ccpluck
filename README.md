# ccpick（仮称）

Claude Code の `settings.json` を **項目単位で** 共有・取り込み・巻き戻しするためのツール群です。
設計の背景は [HANDOFF.md](HANDOFF.md) を参照してください。

- **項目単位で取り込む**: permission ルール 1 行、hook 1 件、`model` 1 キーといった単位で選んでマージできる
- **巻き戻せる**: 取り込みごとに履歴を残し、取り込み単位・項目単位で戻せる
- **安全に公開できる**: 機密になりうる値を手元でマスクし、項目ごとに「なぜこう設定したか」を添えて公開できる

## 構成

```
packages/core   # 解析・項目分解・マスク・差分・マージ・リスク判定（純粋関数、I/O なし）← 実装済み
packages/cli    # ローカル CLI（マイルストーン 2）
apps/web        # 閲覧・投稿・項目選択 UI（マイルストーン 3〜）
```

## 開発

```bash
pnpm install
pnpm test        # 全パッケージのテスト
pnpm typecheck
pnpm build
pnpm update-schema   # schemastore の JSON Schema から packages/core/src/schema-snapshot.ts を再生成
```

Node 22 と pnpm 10 で確認しています。

## 進捗

| マイルストーン | 状態 |
|---|---|
| 1. core | ✅ 項目分解・リスク判定・マスク・マージ・差分・巻き戻し・バンドル・検証。フィクスチャ 9 個、テスト 119 件 |
| 2. cli | 未着手 |
| 3. web（ローカル版） | 未着手 |
| 4. web（共有版） | 未着手 |
| 5. 集計 | 未着手 |

## `@ccpick/core`

ブラウザと Node の両方で動きます。`node:*` などの I/O には依存しません（ビルド設定で `types: []` にして混入を防いでいます）。ES2022（`Object.hasOwn`、正規表現の後読み）が必要です。

| 関数 | 役割 |
|---|---|
| `decompose(settings)` / `compose(items)` | settings ⇄ 項目の列 |
| `getItemValue` / `upsertItem` / `removeItem` / `itemFromId` | 項目 ID での読み書き |
| `assessRisk(item, rules?)` / `DEFAULT_RISK_RULES` | high / medium / low の判定（ルールはテーブルで拡張可） |
| `maskSettings(settings, opts)` | 公開前のマスク。検出結果（`findings`）も返す |
| `findMaskedLabels` / `fillMasked` / `containsMasked` | 取り込み時のマスク値の検出と埋め戻し |
| `mergeItems(base, items, opts)` | マージ。衝突・矛盾・依存ファイル・ジャーナルを返す |
| `revertOps(current, ops)` | ジャーナルの操作を取り消す（手での変更は衝突として止める） |
| `diffSettings(a, b)` | 項目単位の差分 |
| `createBundle` / `parseBundle` / `createPost` / `verifyMasked` | import バンドルと投稿の形式 |
| `validateSettings(v)` | 書き込み前の検証（構造の誤りはエラー、スキーマにないキーは警告） |

### 項目 ID

`/` 区切りで、配列の並び順に依存しません。

| 種類 (`kind`) | 例 |
|---|---|
| `scalar` | `/model`, `/permissions/defaultMode` |
| `array-element` | `/permissions/allow/{"Bash(npm run test *)"}` |
| `map-entry` | `/env/FOO`, `/enabledPlugins/formatter@anthropic-tools` |
| `hook` | `/hooks/PreToolUse/{matcher:"Bash"}/{command:"~/.claude/hooks/guard.sh"}` |
| `whole` | `/statusLine`（スキーマにあるが分解しないもの） |
| `other` | `/someFutureSetting`（スキーマにない未知のキー） |

- キーのセグメントは JSON Pointer と同じエスケープ（`~` → `~0`、`/` → `~1`）。先頭が `{` のキーは `~2` で始める
- `{"..."}` は配列の要素、`{name:"..."}` は hook の matcher や command（中身は JSON 文字列リテラル）
- matcher のない hook グループは `{}`（例: `/hooks/Stop/{}/{command:"say done"}`）

### 受け入れ条件との対応（core 分）

| 条件 | テスト |
|---|---|
| 項目に分解して全部適用すると意味的に同じ JSON になる | `items.test.ts` の round trip（全フィクスチャはキー順までバイト一致。ランダム生成 200 件でも確認）、`merge.test.ts` の「applying every item onto {}」 |
| 既知の秘密パターンがマスク済み出力に残らない | `mask.test.ts` の「leaves no known secret」（全フィクスチャ） |
| high リスクの項目は確認なしでは適用できない | `merge.test.ts` の「refuses high-risk items unless confirmed」。`mergeItems` は `confirmedHighRisk` に ID がない high 項目を適用しない |
| `apply` → `undo` でバイト一致 / 実ホームに書かない | CLI（マイルストーン 2）で担保 |

## 仮決めした事項

HANDOFF の「未決事項」と、実装中に出てきた判断です。変更する場合はこの節も更新してください。

### HANDOFF の未決事項

| 項目 | 仮決め | 理由 |
|---|---|---|
| サービス名 | **`ccpick`**（npm パッケージ `@ccpick/core`、CLI は `npx ccpick`、保存先 `~/.ccpick/`） | `ccshare` は npm で使用済み（Claude Code のプロンプト共有ツール）、`ccsettings` も使用済み（設定テンプレート適用ツール）で紛らわしい。「設定から項目を選んで取り込む」を表す名前にした。2026-11-18 時点で npm 上は未使用。リポジトリのディレクトリ名は `ccshare` のまま |
| 共有版のホスティングと DB | **Cloudflare Pages + Workers + D1** | Web は静的ページ + core のブラウザ実行が中心で、サーバーの役割は投稿の保存・検索・GitHub OAuth に限られる。安価で、マイルストーン 3 の静的ページをそのまま載せられる。マイルストーン 4 の着手時に再検討する |
| 投稿のライセンス | **CC0-1.0 を既定**（`PostMeta.license`、`DEFAULT_LICENSE`） | 設定の断片を気兼ねなく取り込めるようにするため。投稿者が変更できる形にしてある |
| hook スクリプトの同梱 | **MVP では同梱しない**。参照しているスクリプトを `mergeItems` の `dependencies` で返し、CLI が「依存ファイル不足」として表示する | 任意コードの配布になり安全面の設計が要る。将来同梱する場合は、内容ハッシュでの固定・全文表示・high リスク扱いを前提にする |
| プロジェクトスコープと `~/.claude.json` | **MVP は `~/.claude/settings.json` のみ**。`.claude/settings.json` と `settings.local.json` は後で `--scope` で対応。`~/.claude.json`（MCP 設定など）は扱わない | HANDOFF の方針どおり。`~/.claude.json` には OAuth 情報なども入るため対象外のままにする |

### core の実装上の判断

**分解**
- 集合（和集合マージ）として扱う配列: `permissions.allow / deny / ask / additionalDirectories`、トップレベルの `enabledMcpjsonServers`、`disabledMcpjsonServers`、`claudeMdExcludes`、`skippedMarketplaces`、`skippedPlugins`、`httpHookAllowedEnvVars`、`allowedHttpHookUrls`。並びに意味がある `fallbackModel`、`companyAnnouncements`、`availableModels` などは `whole` として丸ごと扱う
- キー単位に分解するオブジェクト: `env`、`enabledPlugins`、`extraKnownMarketplaces`、`pluginConfigs`、`skillOverrides`、`modelOverrides`
- スキーマにない permissions 配下のキー（例: `permissions.futureKey`）も `other` として丸ごと 1 項目
- hook の同一性は `command` → `prompt` → `url` の順で、どれもなければキーをソートした JSON 全体
- ラウンドトリップで消えるもの: 空のコンテナ（`"allow": []`、`"env": {}`）、配列内の重複要素、同じ matcher を持つ複数の hook グループの区切り（1 グループにまとまる。実行される hook は同じ）。いずれも警告を出すか、意味が変わらないもの
- 形式が想定と違う hooks イベント（配列でないなど）は落とさず丸ごと 1 項目にする。ただし `validateSettings` ではエラーにする
- `__proto__` / `constructor` / `prototype` というキーは項目にしない（外部から来るバンドルによるプロトタイプ汚染を防ぐため）

**マージ**
- hooks で同じ command がすでにあれば、`timeout` など他のフィールドが違っても重複として除く（HANDOFF どおり）
- high リスクの確認は CLI 任せにせず、core の `mergeItems` が `confirmedHighRisk` を要求する
- マスク値（`<<MASKED:...>>`）が残っている項目は適用しない。CLI が値を入力させて `fillMasked` で埋めてから渡す
- allow / deny の矛盾は、完全一致に加えて、片方が他方を包含する場合を検出する（`Bash` と `Bash(rm *)`、`Bash(rm *)` と `Bash(rm -rf /)` など）。`ask` との重なりは見ていない
- 項目単位で戻した結果コンテナが空になったら、そのコンテナも消す（取り込み単位の `undo` は CLI がスナップショットから戻すのでバイト一致する）

**リスク判定**（HANDOFF の表に加えたもの）
- high: `subagentStatusLine`、`fileSuggestion`、`awsAuthRefresh`、`awsCredentialExport`、`gcpAuthRefresh`、`otelHeadersHelper`、`processWrapper`、`policyHelper`（いずれもコマンドを実行する）、`skipDangerousModePermissionPrompt: true`、`*` 単体の allow、`PowerShell` / `PowerShell(*)` の allow、通信先・プロキシ・TLS・認証トークン・`NODE_OPTIONS` などを変える env
- medium: スキーマにない未知のキー、`acceptEdits` / `dontAsk` / `auto` の defaultMode、MCP・プラグイン・マーケットプレイスの有効化、`sandbox`
- どのルールにも当たらなければ low

**マスク**
- `env` の値は既定ですべてマスクする。`publicEnvKeys` で公開を許可したキーでも、既知の秘密パターンに当たればマスクする
- 文字列の一部だけが秘密の場合（hook コマンド内の `Bearer` トークンや URL 内の認証情報など）は、その部分だけを置き換える。1 つの文字列に複数ある場合はラベルに `#2`、`#3` を付ける
- キー名による判定（`token`、`secret`、`password`、`auth`、`...key` など）は env 以外のネストしたキーに適用し、スキーマにあるトップレベルのキー（`apiKeyHelper` など。値はスクリプトのパス）には適用しない
- エントロピー判定: 20 文字以上、文字種 3 種以上（または 32 文字以上の 16 進）、数字を含み、1 文字あたり 3.5 ビット以上。パスや URL らしいものは除く。UUID もマスクされる
- ホームディレクトリ: `/Users/<name>`、`/home/<name>`、`C:\Users\<name>`（`C:/Users/<name>` も）を `~` に置き換える。Windows は先頭部分だけを置き換え、残りの `\` はそのまま。`/Users/Shared` は対象外。引用符内の `~` はシェルで展開されないので、取り込む側は注意が必要（差分表示で確認する前提）
- ホスト名（`.internal`、`.corp`、`.local` など）、リポジトリ名、`domain:` 指定、プライベート IP は書き換えず、ハイライト用の `hint` として返す
- `verifyMasked` / `createPost` はマスク済みの settings をもう一度検査し、マスクすべき値が残っていれば投稿を作らない（サーバー側の受け付け時にも使う想定）

**スキーマ**
- `https://json.schemastore.org/claude-code-settings.json` のスナップショット（2026-11-18 取得、トップレベル 142 キー）を `schema-snapshot.ts` に同梱し、説明文（`describeItem`）と未知キーの判定に使う。スキーマにないキーは警告のみ
