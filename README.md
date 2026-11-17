# ccpick（仮称）

Claude Code の `settings.json` を **項目単位で** 共有・取り込み・巻き戻しするためのツール群です。
設計の背景は [HANDOFF.md](HANDOFF.md) を参照してください。

- **項目単位で取り込む**: permission ルール 1 行、hook 1 件、`model` 1 キーといった単位で選んでマージできる
- **巻き戻せる**: 取り込みごとに履歴を残し、取り込み単位・項目単位で戻せる
- **安全に公開できる**: 機密になりうる値を手元でマスクし、項目ごとに「なぜこう設定したか」を添えて公開できる

## 構成

```
packages/core   # 解析・項目分解・マスク・差分・マージ・リスク判定（純粋関数、I/O なし）← 実装済み
packages/cli    # ローカル CLI。~/.claude/settings.json の読み書き・履歴・巻き戻し ← 実装済み
apps/web        # 項目選択 UI。ローカル版はバックエンドなしの静的ページ ← ローカル版は実装済み
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
| 1. core | ✅ 項目分解・リスク判定・マスク・マージ・差分・巻き戻し・バンドル・検証。フィクスチャ 9 個、テスト 120 件 |
| 2. cli | ✅ `export --mask` / `apply` / `history` / `undo` / `revert`。テスト 37 件 |
| 3. web（ローカル版） | ✅ 貼り付け → マスク候補のハイライト → 項目ごとに選択・注釈 → import バンドル／投稿用 JSON を書き出す。テスト 14 件 |
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

## `ccpick`（CLI）

```bash
pnpm build
node packages/cli/dist/bin.js --help      # 公開後は npx ccpick
```

| コマンド | 内容 |
|---|---|
| `ccpick apply <bundle>` | 差分とリスクを表示 → 確認 → 適用。`<bundle>` はファイル、https URL、`-`（標準入力）。import バンドルと投稿（`export` の出力）のどちらも受け付ける |
| `ccpick history [importId]` | 取り込み履歴の一覧／詳細（`--json`） |
| `ccpick undo <importId>` | 取り込み単位で戻す |
| `ccpick revert <itemId>` | 項目単位で戻す（`--import <importId>` で対象の取り込みを指定） |
| `ccpick export --mask` | 手元の設定をマスクして投稿用 JSON を作る（`--public-env`、`--notes`、`--tag`、`-o`） |

共通オプション: `--settings-path`（既定 `$CLAUDE_CONFIG_DIR/settings.json`、なければ `~/.claude/settings.json`）、`--data-dir`（既定 `$CCPICK_HOME`、なければ `~/.ccpick`）。

**apply の流れ**
1. バンドルを検証する。ID と値が食い違う項目が 1 つでもあれば全体を中止する
2. マスク値を含む項目は、対話時は値を入力させ（空ならスキップ）、非対話時はスキップする
3. 衝突（既存の値と違うスカラー・env キー）は項目ごとに上書き／スキップを選ぶ。非対話時は `--overwrite` / `--skip-conflicts`、指定がなければスキップ
4. high リスク項目は内容全文と理由を表示し、`yes` の入力を求める。非対話時は `--allow-high <itemId>` で項目ごとに明示しない限り適用しない（`--yes` では適用されない）
5. 計画（追加／置換／スキップ）、allow と deny の矛盾、依存ファイル不足を表示し、全体の確認（`y` または `--yes`）を求める。`--dry-run` はここで止まる
6. 履歴を記録してから、一時ファイルに書いて rename する。書き込む前に、書き込む文字列そのものを検証する

**履歴** は `~/.ccpick/imports/<importId>.json` に 1 回の取り込みごとに保存する。適用前のファイル全体（`beforeText`）、適用直後の sha256、項目ごとのジャーナル（`{itemId, op, before, after}`）、revert 済みの項目を持つ。

**undo** は、ファイルが適用直後のまま（sha256 一致）なら適用前の中身をそのまま書き戻す（バイト一致。適用前にファイルがなければ削除する）。その後にファイルが変わっていれば、ジャーナルから項目ごとに戻し、適用後に手で変更された項目があれば止める（`--force` で変更されていない項目だけ戻す）。

**revert** は、その項目を最後に適用した取り込みの操作だけを取り消す。適用後に手で変更されていれば止める。

**テストと実ホーム**: CLI のテストは `test/setup.ts` で `HOME` / `CLAUDE_CONFIG_DIR` / `CCPICK_HOME` を一時ディレクトリに向け、すべてのコマンドに一時ディレクトリの `--settings-path` / `--data-dir` を渡す。さらにテストの前後で本物の `~/.claude/settings.json` と `~/.ccpick` の更新時刻とサイズが変わっていないことを検査している。

## Web（ローカル版）

```bash
pnpm --filter @ccpick/web dev       # 開発サーバー（http://localhost:5173）
pnpm --filter @ccpick/web build     # apps/web/dist に静的ファイルを出力
pnpm --filter @ccpick/web preview   # ビルド結果を http://localhost:4173 で確認
```

`apps/web/dist` はどこに置いても動く静的ファイルです（相対パスでビルド）。ES モジュールを使うため `file://` で直接開くことはできず、何らかの HTTP サーバーから配信する必要があります。

1. settings.json を貼り付ける（ファイルを開く・ドロップ・サンプルも可）。構文エラーは行番号を出す
2. 「秘密になりうる値をマスクする」が既定でオン。env は公開してよいキーだけ個別に選ぶ。マスクした値は菫色、社内ホスト名などの確認してほしい箇所は波線で示す
3. 項目ごとにリスク（左端の帯。high は斜線）、理由、スキーマの説明、参照しているスクリプト、マスク値の有無を表示する。リスク・文字列・選択中で絞り込み、「low をすべて選択」などでまとめて選べる。項目ごとに「なぜこう設定したか」を書ける
4. 「取り込み用に書き出す」で import バンドル（`npx ccpick apply ccpick-bundle.json` に渡す）、「投稿用に書き出す」でマスク済みの設定・注釈・メタ情報（投稿形式）を保存またはコピーする

**貼り付けた内容を外に出さないための作り**
- 処理はすべて `@ccpick/core` をブラウザで動かして行う。サーバーは不要
- 本番ビルドの HTML に CSP を入れ、`connect-src 'none'` で通信を禁止している。外部のフォント・スクリプト・画像も読み込まない
- 入力も選択も保存しない（localStorage なども使わない）。リロードすると消える

## 受け入れ条件との対応

| 条件 | テスト |
|---|---|
| 項目に分解して全部適用すると意味的に同じ JSON になる | `items.test.ts` の round trip（全フィクスチャはキー順までバイト一致。ランダム生成 200 件でも確認）、`merge.test.ts` の「applying every item onto {}」 |
| 既知の秘密パターンがマスク済み出力に残らない | `mask.test.ts` の「leaves no known secret」（全フィクスチャ） |
| high リスクの項目は確認なしでは適用できない | `merge.test.ts` の「refuses high-risk items unless confirmed」。`mergeItems` は `confirmedHighRisk` に ID がない high 項目を適用しない |
| `apply` の後に `undo` するとバイト単位で一致 | `cli/test/apply.test.ts` の「restores the file byte-for-byte」（タブインデント・末尾改行なしの崩れた書式で確認）、「creates the file when absent and removes it again」、`history.test.ts` の「restores bytes exactly after undoing the newer import first」 |
| high リスク項目は CLI でも確認なしに適用されない | `apply.test.ts` の「never applies high items non-interactively without --allow-high, even with --yes」「requires typing 'yes'」 |
| テストが実ユーザーのホームに書き込まない | `cli/test/setup.ts`（上記） |

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

### Web（ローカル版）の実装上の判断

- フレームワークは使わず、Vite + TypeScript の素の DOM で書いた。画面のロジック（`apps/web/src/model.ts`）は DOM に触れない純粋関数にしてテストしている
- 選択と注釈は元の項目 ID で持ち、マスクの有無を切り替えても失われない。書き出すときにマスク後の ID に付け替える（core の `maskedItemPairs`）
- マスクで 2 つの項目が同じ値になった場合（ユーザー名だけが違うパスなど）は、書き出せないので一覧から外す
- マスクがオフでも import バンドルは書き出せる（他人の公開設定から取り込む用途）。その場合は警告を出す。投稿用 JSON はマスクがオンのときだけ作れる
- 投稿用 JSON には選んだ項目だけを入れる。ライセンスは CC0-1.0 で固定（UI からは変えられない）
- 書体はシステムの日本語ゴシックと等幅のみ。外部フォントを読み込まないのは、通信を一切しない方針に合わせるため

### CLI の実装上の判断

- `export` は MVP では `--mask` 必須。マスクせずに書き出す機能は用意していない
- `export` は確認画面（マスク結果の一覧と公開される JSON 全体）を必ず表示し、`y` か `--yes` がなければ書き出さない。確認画面は標準エラーに出し、標準出力は JSON だけにする
- マスクでパスやコマンドが書き換わると項目 ID も変わるので、`--notes` の注釈のキーはマスク後の ID に付け替える
- `apply` の URL は https のみ（`http://localhost` は開発用に許可）
- 書き戻すときは既存ファイルのインデント（スペース数／タブ）と末尾改行の有無を引き継ぐ。キーの並びは保つが、配列の 1 行書きなど細かい書式は `JSON.stringify` の形になる（undo はバイト一致で戻る）
- 書き込むファイルのパーミッションは既存のものを引き継ぐ（新規は 0600）
- 依存ファイルの確認は `~` / `$HOME` 起点と絶対パスのみ。`$CLAUDE_PROJECT_DIR` 起点のものは「確認していない」として別に表示する
- マスク値を埋めた hook は、埋めた値で項目 ID を作り直す（core の `withValue`）

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
