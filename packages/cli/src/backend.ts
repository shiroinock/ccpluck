/**
 * 投稿の置き場所（バックエンド）の差し替え口。
 * pick / publish / search などのコマンドは、置き場所にはこれだけを通して触れる。
 * 今は GitHub（リポジトリ）の実装だけ。後でサーバーの実装を足す。
 */

/** 投稿の参照。表示は `<置き場所>:<作者>/<名前>`（例: team:kenta/python） */
export interface PostRef {
  remote: string;
  author: string;
  name: string;
}

export interface PostEntry extends PostRef {
  /** 版（GitHub では投稿ファイルを最後に変えたコミットの ID） */
  version: string;
  /** 版の日時（ISO 8601） */
  date: string;
}

export interface PostWithBody extends PostEntry {
  raw: unknown;
}

export interface Identity {
  /** 置き場所でのログイン名（投稿の作者名になる） */
  login: string;
  /** コミットに使うメールアドレス（GitHub では noreply アドレス） */
  email: string;
}

export interface SubmitRequest {
  author: string;
  name: string;
  /** 投稿ファイルの中身 */
  text: string;
  /** 新しい投稿か、更新か（コミットと PR の文面に使う） */
  update: boolean;
  title: string;
  identity: Identity;
}

export interface SubmitResult {
  /** 前回の提出（または公開済みのもの）と中身が同じで、何も送らなかった */
  unchanged: boolean;
  /** 確認先（GitHub では PR の URL） */
  url?: string;
  /** 新しく作ったか（GitHub では PR を新しく作ったか、既存の PR を更新したか） */
  created?: boolean;
}

export interface Backend {
  readonly name: string;
  /** 表示用の説明（例: github:example-org/claude-settings） */
  readonly label: string;
  /** 置き場所の最新を取ってくる */
  sync(): Promise<void>;
  /** 公開済みの投稿の一覧（中身は読まない） */
  list(): Promise<PostEntry[]>;
  /** 公開済みの投稿を 1 件読む。なければ undefined */
  read(author: string, name: string): Promise<PostWithBody | undefined>;
  /** 自分が誰か（投稿するときに使う） */
  whoami(): Promise<Identity>;
  /** 投稿・更新を出す（GitHub では PR を作る・更新する） */
  submit(req: SubmitRequest): Promise<SubmitResult>;
}

/** 投稿の名前・作者名として使える文字。パスに使うので厳しめにする */
export const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

export const formatRef = (r: PostRef) => `${r.remote}:${r.author}/${r.name}`;

/** `team:kenta/python` を読む。形が違えば undefined */
export function parseRef(s: string): PostRef | undefined {
  const m = /^([A-Za-z0-9][A-Za-z0-9_-]*):([^/:]+)\/([^/:]+)$/.exec(s);
  if (!m || !NAME_RE.test(m[2]!) || !NAME_RE.test(m[3]!) || m[2]!.includes("..") || m[3]!.includes("..")) return undefined;
  return { remote: m[1]!, author: m[2]!, name: m[3]! };
}
