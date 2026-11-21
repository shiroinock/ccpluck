# ccpluck（仮称）

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

Node 24 と pnpm 10 で確認しています。

### Nix

```bash
nix run github:shiroinock/ccpluck -- --help    # インストールせずに実行
nix build                                       # ./result/bin/ccpluck（ビルド中に core と CLI のテストも走る）
nix develop                                     # Node 22・pnpm・git の入った開発シェル
nix flake check
```

- `flake.nix` は aarch64-darwin / x86_64-linux / aarch64-linux に対応する（x86_64-darwin は対象外）。nixpkgs は `nixpkgs-unstable` の 1 つだけ
- 依存は `pnpm-lock.yaml` から `fetchPnpmDeps` で固定ハッシュで取り、ビルド中はネットワークに出ない。`pnpm-lock.yaml` を変えたら、`flake.nix` の `pnpmDeps.hash` を `lib.fakeHash` にして一度ビルドし、表示された値に差し替える
- ビルドには nixpkgs の pnpm 10（`pnpm_10`）を使う。開発で使う pnpm 10 と同じ系列で、lockfile の形式（9.0）もそのまま
- パッケージに入るのは CLI と `@ccpluck/core` だけ（Web ローカル版は入らない）。実行時に使う git は wrapper で PATH に足す。`gh` は GitHub のトークンを借りるときだけ使い、PATH にあれば使う

## 進捗

| マイルストーン | 状態 |
|---|---|
| 1. core | ✅ 項目分解・リスク判定・マスク・マージ・差分・巻き戻し・バンドル・検証・もらう／公開する側の並び順。フィクスチャ 9 個、テスト 130 件 |
| 2. cli | ✅ `export --mask` / `apply` / `history` / `undo` / `revert` |
| 3. web（ローカル版） | ✅ もらう／公開するの 2 目的、1 件ずつ決めるタイムラインと一覧。テスト 21 件 |
| 4. CLI の対話 | ✅ `pick`（自分の設定との比較、並び順、2 回目以降の差分、そのまま取り込み）と `publish`（マスク、1 件ずつ選んで理由を書く、`--update` で変わったところだけ）。投稿はファイルと URL で受け渡す。CLI のテスト 56 件 |
| 5. GitHub バックエンド | 🚧 `remote add / list / sync / remove`、`search`、`show`、`updates`、`pick <置き場所>:<作者>/<名前>`（版を記録）、`publish --to`（投稿ごとのブランチに push して PR）。CLI のテスト 65 件。残り：`remote init`（npm 公開後） |
| 6 以降 | フィードとモデレーション → サーバーバックエンド（[docs/use-cases.md](docs/use-cases.md)） |

マイルストーン 4 以降は HANDOFF から組み直した。画面は CLI だけにし、投稿の置き場所はまず社内の GitHub リポジトリ、社外公開のときにサーバーを足す。経緯とユースケースは [docs/use-cases.md](docs/use-cases.md) にある。

## `@ccpluck/core`

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
| `parsePickSource` / `pickCandidates` / `pickView` / `decide` / `deferPick` / `undoPick` | もらう側：投稿・バンドル・settings.json を読み、自分の設定と比べて並べ、1 件ずつ決める |
| `publishCandidates` / `publishAttention` / `hintsIn` / `buildPublishPost` | 公開する側：マスクして、公開前に確かめるべき順に並べ、選んだ項目から投稿を作る |
| `itemGroup` / `itemLabel` / `itemValueText` | 項目の表示（Web と CLI で共通） |

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

## `ccpluck`（CLI）

```bash
pnpm build
node packages/cli/dist/bin.js --help      # 公開後は npx ccpluck
```

| コマンド | 内容 |
|---|---|
| `ccpluck remote add <名前> github:<owner>/<repo>` | 投稿の置き場所（GitHub リポジトリ）を登録し、`~/.ccpluck/remotes/<名前>.git` に bare clone する。`--host`（GitHub Enterprise Server）、`--git-url` |
| `ccpluck remote list / sync [名前] / remove <名前>` | 登録の一覧、最新の取得、登録を外す |
| `ccpluck search [語]` | 置き場所の投稿を探す。`--in`、`--os`、`--tag`、`--key <項目の一部>`、`--for-me`（自分にない項目が多い順） |
| `ccpluck show <投稿>` | 投稿を読む（項目ごとに「あなたにない／値が違う／同じ」と作者の理由） |
| `ccpluck updates` | 置き場所から取り込んだ投稿のうち、前回の pick から更新され、新しく決める項目があるものを出す |
| `ccpluck pick <投稿>` | 投稿から欲しい項目を 1 件ずつ選び、そのまま取り込む。`<投稿>` は `<置き場所>:<作者>/<名前>`、または投稿・バンドル・settings.json のファイルか https URL。`--all`、非対話では `--only <itemId>` か `--yes-low` |
| `ccpluck publish` | 自分の設定をマスクし、公開する項目を 1 件ずつ選びながら理由を書いて投稿を作る（既定 `./ccpluck-post.json`）。`--to <置き場所> [--name <名前>]` で置き場所に出す（PR を作る）。`--update <投稿>` で前回の選択と理由を引き継ぐ |
| `ccpluck apply <bundle>` | 差分とリスクを表示 → 確認 → 適用。`<bundle>` はファイル、https URL、`-`（標準入力）。import バンドルと投稿（`export` の出力）のどちらも受け付ける |
| `ccpluck history [importId]` | 取り込み履歴の一覧／詳細（`--json`） |
| `ccpluck undo <importId>` | 取り込み単位で戻す |
| `ccpluck revert <itemId>` | 項目単位で戻す（`--import <importId>` で対象の取り込みを指定） |
| `ccpluck export --mask` | 手元の設定をマスクして投稿用 JSON を作る（`--public-env`、`--notes`、`--tag`、`-o`） |

共通オプション: `--offline`（置き場所の最新を取らずに手元の写しを使う。search / show / updates / pick）、`--settings-path`（既定 `$CLAUDE_CONFIG_DIR/settings.json`、なければ `~/.claude/settings.json`）、`--data-dir`（既定 `$CCPLUCK_HOME`、なければ `~/.ccpluck`）。

**pick の流れ**
1. 投稿と自分の settings.json を読み、項目ごとに「持っていない／値が違う／同じ」を判定する。同じものは出さない
2. 作者が理由を書いた項目と自分にない項目から 1 件ずつ出す。値が違う（置き換えになる）項目は後ろ。各カードに作者の理由、リスク、自分の今の値を出す
3. 1 キーで決める：`y` もらう、`n` もらわない、`l` あとで（列の最後へ）、`z` ひとつ戻す、`?` 詳しく（項目 ID・スキーマの説明・リスクの理由・値の全文）、`q` ここで終える
4. 「もらう 4 件（high 1、置き換え 1）、もらわない 9 件」とまとめ、あとは apply と同じ流れで取り込む（マスク値の入力、high の `yes` 確認、計画の表示、最後の確認は Enter で適用）。カードで「置き換わります」を見てもらうと決めた項目は、衝突として聞き直さない
5. 決めた結果を `~/.ccpluck/picks/` に覚える。同じ投稿（同じファイルパスか URL）を次に pick すると、前回決めた項目のうち値が変わっていないものは出さない（`--all` で全部）。最後の確認で断ったときと `--dry-run` のときは覚えない

**publish の流れ**
1. settings.json を読んでマスクする（`export --mask` と同じ規則）。マスクした値・置き換えたパス・確認してほしい箇所の件数を出す
2. マスクした値 → high → 確認してほしい箇所（社内ホスト名など）→ medium → low の順に 1 件ずつ出す。カードには公開される値（マスク後）を出す
3. 1 キーで決める：`y` 公開する（続けて理由を 1 行で聞く。Enter で省略）、`n` 公開しない、`l` あとで、`w` 理由を書く、`e` 理由を `$VISUAL` / `$EDITOR` で書く、`v` env の値を公開する／隠す、`z` ひとつ戻す、`?` 詳しく、`q` ここで終える（残りは公開しない）
4. タイトルと用途タグを聞き（`--title` / `--tag` があれば聞かない。OS は実行環境から）、公開される JSON の全文と、残っている確認してほしい箇所を見せてから書き出す
5. 決めた結果を `~/.ccpluck/publish/` に覚える。`publish --update <投稿>` は、前回決めた項目のうち値が変わっていないものを聞かずに引き継ぎ（前回の投稿に入っていたものは「公開する」、理由もそのまま）、増えた・値が変わった項目だけを聞く。タイトルとタグは Enter で前回のまま

**GitHub バックエンド**
- 置き場所は `remote add` で登録する。手元には公開済みのブランチ（既定のブランチ）だけを bare clone で持ち、search / show / updates / pick のたびに fetch する（取れなければ警告して手元の写しを使う）
- 投稿は `posts/<GitHub のログイン名>/<名前>.json`。版は、その投稿ファイルを最後に変えたコミット。`pick` は投稿の参照（`team:kenta/python`）と版を取り込み履歴に記録し、`history` に出す。`updates` は前回 pick した版と今の版を比べる
- `publish --to team` は、GitHub のログイン名を API で調べ、投稿の名前を聞く。同じ名前の投稿が公開済みなら更新として、前回の選択と理由を引き継ぐ。PR がレビュー待ちのまま出し直したときも、手元に覚えた選択と理由を引き継ぐ
- 送る直前にもう一度マスク漏れを検査してから push する（一度 push すると PR を閉じても GitHub に残るため）
- コミットは作業ツリーを使わずに作る（一時的な index に投稿ファイルを足し、`commit-tree`）。親は最新の公開済みブランチ。作者は GitHub の noreply アドレス（`<ID>+<ログイン名>@users.noreply.github.com`）にし、手元の git に設定したメールアドレスは使わない
- push 先は投稿ごとのブランチ `ccpluck/publish/<ログイン名>/<名前>`（自分のブランチなので force push）。そのブランチの PR が開いていれば push で更新され、なければ PR を作る。公開済みと同じ中身なら何も送らない
- トークンは `CCPLUCK_GITHUB_TOKEN` / `GITHUB_TOKEN` / `GH_TOKEN`、なければ `gh auth token --hostname <host>`。https の clone・fetch・push では、利用者の credential helper の後ろにこのトークンを渡す helper を足す
- `CCPLUCK_DEBUG=1` を付けると、実行する git と GitHub API の呼び出しを標準エラーに出す（トークンは出さない）
- テストは手元の bare リポジトリを置き場所にし、GitHub の API（`/user`、PR の一覧と作成）は偽物に差し替えて、clone から PR 作成までを通す

**apply の流れ**
1. バンドルを検証する。ID と値が食い違う項目が 1 つでもあれば全体を中止する
2. マスク値を含む項目は、対話時は値を入力させ（空ならスキップ）、非対話時はスキップする
3. 衝突（既存の値と違うスカラー・env キー）は項目ごとに上書き／スキップを選ぶ。非対話時は `--overwrite` / `--skip-conflicts`、指定がなければスキップ
4. high リスク項目は内容全文と理由を表示し、`yes` の入力を求める。非対話時は `--allow-high <itemId>` で項目ごとに明示しない限り適用しない（`--yes` では適用されない）
5. 計画（追加／置換／スキップ）、allow と deny の矛盾、依存ファイル不足を表示し、全体の確認（`y` または `--yes`）を求める。`--dry-run` はここで止まる
6. 履歴を記録してから、一時ファイルに書いて rename する。書き込む前に、書き込む文字列そのものを検証する

**履歴** は `~/.ccpluck/imports/<importId>.json` に 1 回の取り込みごとに保存する。適用前のファイル全体（`beforeText`）、適用直後の sha256、項目ごとのジャーナル（`{itemId, op, before, after}`）、revert 済みの項目を持つ。

**undo** は、ファイルが適用直後のまま（sha256 一致）なら適用前の中身をそのまま書き戻す（バイト一致。適用前にファイルがなければ削除する）。その後にファイルが変わっていれば、ジャーナルから項目ごとに戻し、適用後に手で変更された項目があれば止める（`--force` で変更されていない項目だけ戻す）。

**revert** は、その項目を最後に適用した取り込みの操作だけを取り消す。適用後に手で変更されていれば止める。

**テストと実ホーム**: CLI のテストは `test/setup.ts` で `HOME` / `CLAUDE_CONFIG_DIR` / `CCPLUCK_HOME` を一時ディレクトリに向け、すべてのコマンドに一時ディレクトリの `--settings-path` / `--data-dir` を渡す。さらにテストの前後で本物の `~/.claude/settings.json` と `~/.ccpluck` の更新時刻とサイズが変わっていないことを検査している。

## Web（ローカル版）

```bash
pnpm --filter @ccpluck/web dev       # 開発サーバー（http://localhost:5173）
pnpm --filter @ccpluck/web build     # apps/web/dist に静的ファイルを出力
pnpm --filter @ccpluck/web preview   # ビルド結果を http://localhost:4173 で確認
```

`apps/web/dist` はどこに置いても動く静的ファイルです（相対パスでビルド）。ES モジュールを使うため `file://` で直接開くことはできず、何らかの HTTP サーバーから配信する必要があります。

画面は「もらう」と「公開する」の 2 つの目的に分かれ、それぞれ「順に見る」（タイムライン）と「一覧から選ぶ」の 2 つの見せ方がある。どちらの見せ方でも選んだ状態は共有される。

**もらう**（誰かの設定から、欲しいキーだけ自分の settings.json へ）
1. 誰かの投稿（`ccpluck-post`）か素の settings.json を貼り付ける。投稿ならタイトル・OS・タグを見出しに出す
2. 任意で自分の settings.json を貼ると、すでに持っている項目は飛ばし（最後にまとめて表示）、値が違う項目には自分の今の値を並べる。比較専用で書き出しには入らない
3. 「順に見る」では、作者が理由を書いた項目・自分に足りない項目から 1 件ずつ出す。作者の理由をいちばん大きく見せ、「もらう（Y）／もらわない（N）／あとで（L）」で決める。Z でひとつ戻す。決めた項目は上の線に積まれ、押すと決め直せる
4. 「取り込み用に書き出す」で import バンドルを保存し、`npx ccpluck apply` に渡す。作者の理由はバンドルの注釈として一緒に持っていく

**公開する**（自分の設定をマスクし、理由を添えて共有する）
1. 自分の settings.json を貼り付ける。マスクは常にオン（外せない）。env は公開してよいキーだけ個別に選ぶ
2. 「順に見る」では、マスクした値 → high → 確認してほしい箇所 → medium → low の順に出し、各項目で「なぜこう設定したか」を書いてから「公開する／公開しない」を決める
3. 「投稿用に書き出す」でタイトル・OS・タグを入れ、マスク済みの設定・理由・メタ情報を保存またはコピーする

**貼り付けた内容を外に出さないための作り**
- 処理はすべて `@ccpluck/core` をブラウザで動かして行う。サーバーは不要
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
| サービス名 | **`ccpluck`**（npm パッケージ `@ccpluck/core`、CLI は `npx ccpluck`、保存先 `~/.ccpluck/`） | `ccshare` は npm で使用済み（Claude Code のプロンプト共有ツール）、`ccsettings` も使用済み（設定テンプレート適用ツール）で紛らわしい。`ccpick` も GitHub に Claude Code 向けの同名ツールが複数あるため避けた。「設定から項目を 1 つずつ摘み取る（pluck）」を表す名前にした。2026-11-18 時点で npm・GitHub ともに同名なし。GitHub のリポジトリは `shiroinock/ccpluck`（手元のディレクトリ名は `ccshare` のまま） |
| 共有版のホスティングと DB | **Cloudflare Pages + Workers + D1** | Web は静的ページ + core のブラウザ実行が中心で、サーバーの役割は投稿の保存・検索・GitHub OAuth に限られる。安価で、マイルストーン 3 の静的ページをそのまま載せられる。マイルストーン 4 の着手時に再検討する |
| 投稿のライセンス | **CC0-1.0 を既定**（`PostMeta.license`、`DEFAULT_LICENSE`） | 設定の断片を気兼ねなく取り込めるようにするため。投稿者が変更できる形にしてある |
| hook スクリプトの同梱 | **MVP では同梱しない**。参照しているスクリプトを `mergeItems` の `dependencies` で返し、CLI が「依存ファイル不足」として表示する | 任意コードの配布になり安全面の設計が要る。将来同梱する場合は、内容ハッシュでの固定・全文表示・high リスク扱いを前提にする |
| プロジェクトスコープと `~/.claude.json` | **MVP は `~/.claude/settings.json` のみ**。`.claude/settings.json` と `settings.local.json` は後で `--scope` で対応。`~/.claude.json`（MCP 設定など）は扱わない | HANDOFF の方針どおり。`~/.claude.json` には OAuth 情報なども入るため対象外のままにする |

### Web（ローカル版）の実装上の判断

- フレームワークは使わず、Vite + TypeScript の素の DOM で書いた。画面のロジック（`apps/web/src/model.ts`）は DOM に触れない純粋関数にしてテストしている
- 選択と注釈は元の項目 ID で持ち、マスクの有無を切り替えても失われない。書き出すときにマスク後の ID に付け替える（core の `maskedItemPairs`）
- マスクで 2 つの項目が同じ値になった場合（ユーザー名だけが違うパスなど）は、書き出せないので一覧から外す
- 画面の組み立ては「SNS依存はUIのせい？」という動画で語られた、タイムライン的 UI（次に見るものをシステムが決めて 1 列に出す）と地形的 UI（自分で探す）の区別に従った。設定のピックは「1 件ずつ判断する」作業なのでタイムラインを主にし、一覧（地形）にいつでも切り替えられるようにした。動画で指摘された中毒性への対策として、件数と進み具合を常に出して終わりを見せ、「すべて確認しました」で止まる。無限には続かない
- 並び順は目的ごとに変える。もらう側は「作者の理由がある・自分に足りない」を先に、公開する側は「公開前に確かめるべき（マスク値・high）」を先に出す。「あとで」は列の最後に回す
- もらう側の比較（自分の settings.json）は表示のためだけに使い、書き出しにも履歴にも入れない。値が違う項目を実際に上書きするかは CLI の apply が改めて確認する
- 「もらう」と「公開する」は作業状態を別々に持つ。タブを切り替えても互いの入力や選択は消えない
- 他人の投稿から取り込むときはマスクしない（投稿はすでにマスク済みで、マスク値は apply 時に入力するかスキップする）。投稿用 JSON は公開する側でだけ作れ、マスクは外せない
- 複数の投稿を流すフィード（投稿の一覧・検索・フォロー）はローカル版では作っていない。その後の方針で、フィードを含む以降の機能は CLI で作ることにした（[docs/use-cases.md](docs/use-cases.md)）。並び順と比較のロジックは core に移し、CLI の `pick` と共有している
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
- `pick` は端末のときだけ 1 件ずつ聞く。端末でないとき（パイプや CI）は `--only` か `--yes-low` を求め、`apply` と同じく `--yes` と `--allow-high` が要る。1 件ずつ聞くときは標準入力をキー入力に使うので、投稿を `-`（標準入力）から読むことはできない
- `pick` のキー入力は Enter の要らない 1 キー（raw モード）。Ctrl+C / Ctrl+D は何も書き込まずに終了する。行の入力（マスク値、`yes`、最後の確認）は質問のたびに readline を開いて閉じる（開いたままだとプロセスが終了しないため）
- `pick` の「前回決めた」は項目 ID と値のハッシュ（キー順に依存しない）で判定する。ID は値に基づくので、投稿が更新されても同じキー・同じ値なら同じとみなし、値が変わったものはもう一度聞く
- `publish` は端末でだけ動く（公開する項目を人が 1 件ずつ確かめるため）。全部をマスクして一度に書き出すなら `export --mask` を使う
- `publish` の `v` で env の公開を許可しても、値がトークンなどの秘密のパターンに当たる場合はマスクしたままにし、その旨を表示する。書き出す直前にも core の `createPost` がマスク漏れを検査する
- `publish` で env の公開を切り替えるとマスクが変わり、項目の並び順も変わりうる。いま見ているカードが入れ替わらないよう、最初の並び順を保つ
- `publish --update` の引き継ぎは、マスク後の項目 ID と値のハッシュで判定する。前回の投稿に入っていた項目は、覚えた決定がなくても「公開する」として引き継ぐ（別のマシンで書き出した投稿でも使える）
- 置き場所の名前・投稿の作者名・投稿の名前は、ファイルパスとブランチ名に使うので英数字と `._-` だけにする（`..` は不可）。`<置き場所>:<作者>/<名前>` の形で、置き場所が登録されていれば置き場所の投稿、そうでなければファイルとして読む
- `remote init`（共有用リポジトリに設定ファイル・マスク検査の Actions・通報のテンプレートを入れる）は、Actions から ccpluck を動かすために npm への公開が要るので後回しにした
- `pick --yes-low` が入れるのは「low・自分の設定にない・マスク値を含まない」項目だけ。値が違う項目は置き換えになるので入れない

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
