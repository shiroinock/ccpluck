# HANDOFF: Claude Code settings.json 共有サイト（仮称 `ccshare`）

このドキュメントは Claude Code への引き継ぎ用です。まず全体を読み、「進め方」の順に実装してください。不明点は「未決事項」を参照し、決まっていないものは仮の判断をして README に記録してください。

---

## 1. 何を作るか

Claude Code の `settings.json` に特化した共有サービス。既存の aitmpl.com（部品配布）や dotfyle（Neovim 設定の閲覧）との違いは次の 3 点。

1. **項目単位で取り込む**: 他人の設定から permission ルール 1 行、hook 1 件、`model` 1 キーといった単位で選んで自分の設定にマージできる
2. **巻き戻せる**: 取り込みごとに履歴を残し、取り込み単位・項目単位で元に戻せる
3. **安全に公開できる**: 機密になりうる値をアップロード前に手元でマスクし、各項目に「なぜこう設定したか」を書き添えて公開できる

## 2. 構成

TypeScript の pnpm モノレポ。

```
packages/core   # 解析・項目分解・マスク・差分・マージ・リスク判定（純粋関数、I/O なし）
packages/cli    # npx で動くローカル CLI。~/.claude/settings.json の読み書き・履歴・巻き戻し
apps/web        # 閲覧・投稿・項目選択 UI。core をブラウザでも動かす
```

- **core はブラウザと Node の両方で動くこと**（マスクをクライアント側で完結させるため）
- Web からユーザーのファイルは書き換えられない。**書き込みは必ず CLI 経由**とする
- Web で選んだ項目は「import バンドル」（JSON）として出力し、CLI が適用する
  - 例: `npx ccshare apply <bundle-url-or-file>`

## 3. 項目（Item）の定義

`settings.json` を「項目」に分解する。項目 ID は値ベースのパスで、配列の並び順に依存させない。

| 種類 | 例 | 項目 ID の例 |
|---|---|---|
| スカラー | `model`, `cleanupPeriodDays`, `permissions.defaultMode` | `/model` |
| 文字列配列の要素 | `permissions.allow/deny/ask`, `permissions.additionalDirectories` | `/permissions/allow/{"Bash(npm run test *)"}` |
| オブジェクトのキー | `env.FOO` | `/env/FOO` |
| hook | `hooks.PreToolUse[matcher=Bash].hooks[]` の 1 コマンド | `/hooks/PreToolUse/{matcher:"Bash"}/{command:"..."}` |
| 丸ごと扱うもの | `statusLine` など | `/statusLine` |

- 未知のキーも落とさず、「その他」として丸ごと 1 項目にする
- 項目の説明文は JSON Schema（`https://json.schemastore.org/claude-code-settings.json`）の `description` から引く。スキーマは最新の CLI より遅れることがあるので、スキーマにないキーは警告にとどめ、エラーにはしない

## 4. マージ規則

| 種類 | 規則 |
|---|---|
| スカラー | 既存値があれば衝突として扱い、ユーザーに「上書き / スキップ」を選ばせる |
| 文字列配列 | 和集合（重複は除く）。並びは既存の後ろに追加 |
| env | キー単位。同じキーがあれば衝突扱い |
| hooks | 同じイベント・同じ matcher のグループに追加。同一 command は重複として除く |

追加で検出する矛盾:
- 取り込む `allow` が既存の `deny` と衝突する場合（またはその逆）は警告する
- hook や statusLine が参照するスクリプト（`~/.claude/hooks/xxx.sh` など）が手元にない場合は「依存ファイル不足」として表示する。MVP ではスクリプトの同梱はしない

## 5. リスク判定

各項目に `high / medium / low` を付け、UI と CLI の両方で目立たせる。high の項目は、適用前に内容全文の表示と明示的な確認を必須にする。

- **high**
  - `hooks` の全項目（任意のコマンドが実行されるため）
  - `statusLine` の command
  - `apiKeyHelper`
  - `permissions.defaultMode: "bypassPermissions"`
  - `Bash` / `Bash(*)` のような広すぎる allow
  - `env.ANTHROPIC_BASE_URL` など通信先を変える env
- **medium**: 特定コマンドの allow、`additionalDirectories`、その他の env
- **low**: `model`、`cleanupPeriodDays`、`outputStyle` などの表示・挙動系

判定ルールは core にテーブルとしてまとめ、拡張しやすくする。

## 6. マスク（公開前）

- **必ずクライアント側（ブラウザまたは CLI）で行い、マスク前の値をサーバーに送らない**
- 検出の手がかり
  - キー名: `token|secret|key|password|auth|credential` など
  - 値のパターン: `sk-`、`ghp_`、`xox[bp]-`、JWT、URL 内の認証情報など
  - エントロピー: 長くてランダムな文字列
  - 絶対パス: `/Users/<name>/`、`/home/<name>/`、`C:\Users\<name>\` → `~/` に置き換える
  - `env` の値は**既定で全部マスク**し、ユーザーが個別に公開を許可する方式にする
  - permission ルールやパス内のホスト名・社内リポジトリ名は候補としてハイライトだけする
- 置き換え後の形式は `"<<MASKED:env.GITHUB_TOKEN>>"`。構造は保つ
- 取り込み時にマスク値があれば、CLI が入力を求めるか、スキップさせる
- 最後に人が確認する画面（差分表示）を必ず挟む

## 7. 意図の書き添え（注釈）

JSON にはコメントを書けないため、注釈は別に持つ。

```json
{
  "version": 1,
  "notes": {
    "/permissions/deny/{\"Bash(rm -rf *)\"}": { "why": "誤爆防止。git 管理外も消えるため", "tags": ["safety"] },
    "/model": { "why": "普段は速さ優先" }
  }
}
```

投稿は「マスク済み settings + 注釈 + メタ情報（OS、主な用途タグ）」の 1 セットとする。

## 8. 履歴と巻き戻し（CLI）

- 保存先: `~/.ccshare/`（Claude Code の設定ディレクトリは汚さない）
- `apply` のたびに次を記録する
  - 適用前の settings 全体のスナップショット
  - ジャーナル: 適用した各項目について `{importId, itemId, op: add|replace, before, after}`
- コマンド案
  - `ccshare apply <bundle>`: 差分とリスクを表示 → 確認 → 適用
  - `ccshare history`: 取り込み履歴の一覧
  - `ccshare undo <importId>`: 取り込み単位で戻す
  - `ccshare revert <itemId>`: 項目単位で戻す（その後に手で変更されていたら衝突として止める）
  - `ccshare export --mask`: 手元の設定をマスクして投稿用バンドルを作る
- 書き込みは一時ファイルに書いてから rename する（アトミック書き込み）。書き込み前にスキーマ検証と JSON パースの確認を行う
- 対象は MVP では `~/.claude/settings.json`（ユーザースコープ）のみ。`.claude/settings.json` や `settings.local.json` は後で `--scope` で対応する
- `~/.claude.json`（MCP 設定などを含む）には触らない

## 9. 進め方（マイルストーン）

1. **core**: 項目分解・リスク判定・マスク・マージ・差分を実装し、ユニットテストを揃える。フィクスチャとして典型的な settings を 5〜10 個作る（hooks あり、env あり、未知キーあり、Windows パスありなど）
2. **cli**: `export --mask` → `apply` → `history` / `undo` / `revert` の順に実装。`--settings-path` で任意のファイルに対して動かせるようにし、テストで本物の `~/.claude` に触れないこと
3. **web（ローカル版）**: settings を貼る → マスク候補のハイライト → 項目ごとにチェック → import バンドルを書き出す。バックエンドなしで動く静的ページ
4. **web（共有版）**: 投稿・閲覧・注釈・検索。認証は GitHub OAuth を想定
5. **集計**: 「`rm -rf` を deny している人の割合」など項目ごとの統計

各マイルストーンの終わりに、テストが通ることと README の更新を確認すること。

## 10. 受け入れ条件（MVP = マイルストーン 1〜3）

- 任意の有効な settings.json を項目に分解し、元に戻すと（項目を全部適用すると）意味的に同じ JSON になる（ラウンドトリップのテスト）
- 既知の秘密パターンがマスク済み出力に残らない（テストで保証）
- `apply` の後に `undo` すると、ファイルが適用前とバイト単位で一致する
- high リスクの項目は、確認なしでは適用できない
- テストが実ユーザーのホームディレクトリに一切書き込まない

## 11. 未決事項

- サービス名（`ccshare` は仮）
- 共有版のホスティングと DB（Cloudflare + D1、Supabase など）
- 投稿された設定のライセンス表記（CC0 を既定にするか）
- hook スクリプトの同梱と配布をどう扱うか（安全面の設計が必要）
- プロジェクトスコープと `~/.claude.json`（MCP）への対応範囲
