import { TOP_LEVEL_KEYS } from "./schema-snapshot.js";
import { clone, isPlainObject, toDotPath, walkStrings, type JsonValue, type Settings } from "./json.js";

/**
 * 公開前のマスク。すべて呼び出し側（ブラウザまたは CLI）で実行する純粋関数。
 *
 * 置き換え後の形式: "<<MASKED:env.GITHUB_TOKEN>>"
 * 文字列の一部だけが秘密の場合（hook コマンド内のトークンなど）は、その部分だけをマーカーに置き換える。
 */

export const MASK_PREFIX = "<<MASKED:";
export const MASK_SUFFIX = ">>";
export const MASK_MARKER_RE = /<<MASKED:([^<>]+)>>/g;

export type FindingKind =
  | "env" // env の値（既定で全部マスク）
  | "secret-key" // キー名が秘密っぽい
  | "secret-pattern" // 既知のトークン形式
  | "entropy" // 長くランダムな文字列
  | "home-path" // ホームディレクトリの絶対パス
  | "hint"; // ホスト名・リポジトリ名など。ハイライトのみ

export interface MaskFinding {
  kind: FindingKind;
  /** masked: マーカーに置換 / replaced: 別の値に置換（パス）/ highlight: 変更なし */
  action: "masked" | "replaced" | "highlight";
  /** 元の settings での JSON パス */
  jsonPath: (string | number)[];
  /** 表示用のドット区切りパス（マーカーのラベルにも使う） */
  path: string;
  reason: string;
  /** highlight のとき、マスク後の文字列での該当範囲 */
  match?: string;
  /** 置換に使ったマーカー（masked のとき） */
  marker?: string;
}

export interface MaskOptions {
  /** 公開を許可する env のキー。既定は空（= env の値は全部マスク） */
  publicEnvKeys?: string[];
  /** 追加の秘密パターン */
  extraSecretPatterns?: SecretPattern[];
  /** エントロピー判定の閾値 */
  entropy?: { minLength?: number; minBitsPerChar?: number };
}

export interface MaskResult {
  settings: Settings;
  findings: MaskFinding[];
}

export interface SecretPattern {
  id: string;
  re: RegExp;
  /** マスクする捕捉グループ（省略時はマッチ全体） */
  group?: number;
  reason: string;
}

export const SECRET_PATTERNS: SecretPattern[] = [
  {
    id: "private-key",
    re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    reason: "秘密鍵",
  },
  { id: "anthropic", re: /sk-ant-[A-Za-z0-9_-]{10,}/g, reason: "Anthropic API キー" },
  { id: "sk", re: /\bsk-[A-Za-z0-9_-]{16,}/g, reason: "API キー（sk-）" },
  { id: "github", re: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g, reason: "GitHub トークン" },
  { id: "gitlab", re: /\bglpat-[A-Za-z0-9_-]{20,}/g, reason: "GitLab トークン" },
  { id: "slack", re: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g, reason: "Slack トークン" },
  { id: "aws-access-key", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, reason: "AWS アクセスキー" },
  { id: "google-api-key", re: /\bAIza[0-9A-Za-z_-]{35}/g, reason: "Google API キー" },
  { id: "npm", re: /\bnpm_[A-Za-z0-9]{36}\b/g, reason: "npm トークン" },
  {
    id: "jwt",
    re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
    reason: "JWT",
  },
  {
    id: "url-credentials",
    re: /\b[a-z][a-z0-9+.-]*:\/\/([^\s:@/'"]+:[^\s@/'"]+)@/gi,
    group: 1,
    reason: "URL に埋め込まれた認証情報",
  },
  {
    id: "bearer",
    re: /\b(?:Bearer|Basic|token)\s+([A-Za-z0-9._~+/=-]{16,})/g,
    group: 1,
    reason: "Authorization ヘッダーの値",
  },
  {
    id: "assignment",
    re: /(?:token|secret|password|passwd|api[_-]?key|access[_-]?key)["']?\s*[=:]\s*["']?([^\s"'&;]{8,})/gi,
    group: 1,
    reason: "秘密らしい名前への代入",
  },
];

/** キー名が秘密を表すか（オブジェクトのプロパティ名に対して判定） */
export const SECRET_KEY_RE =
  /(token|secret|passw(or)?d|credential|api[_-]?key|access[_-]?key|private[_-]?key|(^|[_\-.])key$|auth(?!or)|cookie|session)/i;

export const HINT_PATTERNS: { re: RegExp; reason: string }[] = [
  {
    re: /\b(?:[a-z0-9-]+\.)+(?:internal|corp|local|lan|intra|intranet|private|localdomain)\b/gi,
    reason: "社内ホスト名の可能性",
  },
  { re: /(?:github\.com|gitlab\.com|bitbucket\.org)[/:][\w.-]+\/[\w.-]+/gi, reason: "リポジトリ名" },
  { re: /\bgit@[\w.-]+:[\w.-]+\/[\w.-]+/gi, reason: "リポジトリ名" },
  { re: /\bdomain:([\w.-]+)/g, reason: "アクセス先のドメイン" },
  {
    re: /\b(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/g,
    reason: "プライベート IP アドレス",
  },
];

// ---------------------------------------------------------------------------

export function shannonBitsPerChar(s: string): number {
  const counts = new Map<string, number>();
  for (const c of s) counts.set(c, (counts.get(c) ?? 0) + 1);
  let h = 0;
  for (const n of counts.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

function looksRandom(tok: string, minLength: number, minBits: number): boolean {
  if (tok.length < minLength) return false;
  if (/^[~./$]/.test(tok) || /^https?:/i.test(tok) || tok.includes(MASK_PREFIX)) return false;
  // パスらしいもの（区切りの間に英字の単語がある）は除外
  if ((tok.match(/\//g) ?? []).length >= 2 && /\/[a-z]{3,}\//i.test(tok)) return false;
  const classes =
    Number(/[a-z]/.test(tok)) + Number(/[A-Z]/.test(tok)) + Number(/\d/.test(tok)) + Number(/[-_+/=]/.test(tok));
  const isHex = /^[0-9a-f]{32,}$/i.test(tok);
  if (!isHex && classes < 3) return false;
  if (!/\d/.test(tok)) return false;
  return shannonBitsPerChar(tok) >= (isHex ? 3.0 : minBits);
}

// Windows を先に処理する（C:/Users/... が macOS のパターンに先に当たらないように）
const HOME_PATTERNS: { re: RegExp; reason: string }[] = [
  {
    re: /\b[A-Za-z]:(?:\\\\|\\|\/)Users(?:\\\\|\\|\/)[^\\/\s"'`:;]+(?:\\\\|\\|\/)?/gi,
    reason: "Windows のホームディレクトリ",
  },
  { re: /\/Users\/(?!Shared(?:\/|$))[^/\s"'`:;]+(?=\/|$|[\s"'`:;)])/g, reason: "macOS のホームディレクトリ" },
  { re: /\/home\/[^/\s"'`:;]+(?=\/|$|[\s"'`:;)])/g, reason: "Linux のホームディレクトリ" },
];

/** ホームディレクトリの絶対パスを ~ に置き換える */
export function replaceHomePaths(s: string): { value: string; replaced: string[] } {
  const replaced: string[] = [];
  let out = s;
  for (const { re } of HOME_PATTERNS) {
    out = out.replace(re, (m) => {
      replaced.push(m);
      return /[\\/]$/.test(m) ? "~/" : "~";
    });
  }
  return { value: out, replaced };
}

function labelFor(jsonPath: (string | number)[]): string {
  return toDotPath(jsonPath).replace(/[<>]/g, "_");
}

function marker(label: string): string {
  return `${MASK_PREFIX}${label}${MASK_SUFFIX}`;
}

/** 最も近いオブジェクトキー（配列インデックスを飛ばす） */
function nearestKey(jsonPath: (string | number)[]): string | undefined {
  for (let i = jsonPath.length - 1; i >= 0; i--) {
    const seg = jsonPath[i];
    if (typeof seg === "string") return seg;
  }
  return undefined;
}

function setAt(root: JsonValue, jsonPath: (string | number)[], value: string): void {
  let cur: JsonValue = root;
  for (let i = 0; i < jsonPath.length - 1; i++) {
    cur = (cur as Record<string | number, JsonValue>)[jsonPath[i] as string] as JsonValue;
  }
  (cur as Record<string | number, JsonValue>)[jsonPath[jsonPath.length - 1] as string] = value;
}

/** 1 つの文字列をマスクする。 */
function maskString(
  value: string,
  jsonPath: (string | number)[],
  opts: Required<Pick<MaskOptions, "publicEnvKeys">> & MaskOptions,
  findings: MaskFinding[],
): string {
  const path = toDotPath(jsonPath);
  const label = labelFor(jsonPath);
  const base = { jsonPath, path };

  if (value.startsWith(MASK_PREFIX) && value.endsWith(MASK_SUFFIX)) return value;

  // 1. env の値は既定で全部マスク
  const isEnv = jsonPath[0] === "env" && jsonPath.length === 2;
  if (isEnv && !opts.publicEnvKeys.includes(String(jsonPath[1]))) {
    findings.push({ ...base, kind: "env", action: "masked", reason: "env の値は既定で非公開", marker: marker(label) });
    return marker(label);
  }

  // 2. キー名が秘密っぽい（env 以外。スキーマにあるトップレベルキーは名前判定しない）
  const key = nearestKey(jsonPath);
  const isKnownTop = jsonPath.length === 1 && Object.hasOwn(TOP_LEVEL_KEYS, String(jsonPath[0]));
  if (!isEnv && key !== undefined && !isKnownTop && SECRET_KEY_RE.test(key) && value.length > 0) {
    findings.push({
      ...base,
      kind: "secret-key",
      action: "masked",
      reason: `キー名 "${key}" が秘密情報を示しています`,
      marker: marker(label),
    });
    return marker(label);
  }

  let out = value;
  let n = 0;
  const nextMarker = () => marker(n++ === 0 ? label : `${label}#${n}`);

  // 3. 既知の秘密パターン
  for (const pat of [...SECRET_PATTERNS, ...(opts.extraSecretPatterns ?? [])]) {
    const re = new RegExp(pat.re.source, pat.re.flags.includes("g") ? pat.re.flags : `${pat.re.flags}g`);
    out = out.replace(re, (whole, ...groups: unknown[]) => {
      const target = pat.group ? (groups[pat.group - 1] as string | undefined) : whole;
      if (!target || target.includes(MASK_PREFIX)) return whole;
      const m = nextMarker();
      findings.push({ ...base, kind: "secret-pattern", action: "masked", reason: pat.reason, marker: m });
      return whole.replace(target, m);
    });
  }

  // 4. エントロピー
  const minLength = opts.entropy?.minLength ?? 20;
  const minBits = opts.entropy?.minBitsPerChar ?? 3.5;
  const tokens = out.split(/[\s"'`=:,;()[\]{}<>|&?#]+/).filter(Boolean);
  for (const tok of new Set(tokens)) {
    if (!looksRandom(tok, minLength, minBits)) continue;
    const m = nextMarker();
    findings.push({ ...base, kind: "entropy", action: "masked", reason: "ランダムな文字列（秘密の可能性）", marker: m });
    out = out.split(tok).join(m);
  }

  // 5. ホームディレクトリ
  const home = replaceHomePaths(out);
  if (home.replaced.length > 0) {
    findings.push({
      ...base,
      kind: "home-path",
      action: "replaced",
      reason: "ホームディレクトリの絶対パスを ~ に置き換えました",
    });
    out = home.value;
  }

  // 6. ヒント（変更しない）
  for (const h of HINT_PATTERNS) {
    for (const m of out.matchAll(new RegExp(h.re.source, h.re.flags))) {
      findings.push({ ...base, kind: "hint", action: "highlight", reason: h.reason, match: m[0] });
    }
  }
  return out;
}

/**
 * settings をマスクした新しいオブジェクトと、検出結果を返す。元の settings は変更しない。
 * キー（プロパティ名）はマスクしない。構造は保つ。
 */
export function maskSettings(settings: Settings, options: MaskOptions = {}): MaskResult {
  const out = clone(settings);
  const findings: MaskFinding[] = [];
  const opts = { ...options, publicEnvKeys: options.publicEnvKeys ?? [] };
  // walkStrings はジェネレーターなので先に列挙してから書き換える
  const strings = [...walkStrings(settings)];
  for (const { path, value } of strings) {
    const masked = maskString(value, path, opts, findings);
    if (masked !== value) setAt(out, path, masked);
  }
  // env の値が文字列以外（数値など）でも非公開扱いにする
  if (isPlainObject(out.env)) {
    for (const [k, v] of Object.entries(out.env)) {
      if (typeof v !== "string" && v !== null && !opts.publicEnvKeys.includes(k)) {
        const m = marker(labelFor(["env", k]));
        out.env[k] = m;
        findings.push({ kind: "env", action: "masked", jsonPath: ["env", k], path: toDotPath(["env", k]), reason: "env の値は既定で非公開", marker: m });
      }
    }
  }
  return { settings: out, findings };
}

// ---------------------------------------------------------------------------
// 取り込み側

/** 値に含まれるマスクマーカーのラベル一覧（重複なし） */
export function findMaskedLabels(value: JsonValue): string[] {
  const labels = new Set<string>();
  for (const { value: s } of walkStrings(value)) {
    for (const m of s.matchAll(MASK_MARKER_RE)) labels.add(m[1] as string);
  }
  return [...labels];
}

export function containsMasked(value: JsonValue): boolean {
  return findMaskedLabels(value).length > 0;
}

/** マーカーを実際の値で埋める。values にないラベルはそのまま残す。 */
export function fillMasked<T extends JsonValue>(value: T, values: Record<string, string>): T {
  const replace = (s: string) =>
    s.replace(MASK_MARKER_RE, (m, label: string) => (Object.hasOwn(values, label) ? (values[label] as string) : m));
  const walk = (v: JsonValue): JsonValue => {
    if (typeof v === "string") return replace(v);
    if (Array.isArray(v)) return v.map(walk);
    if (isPlainObject(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value) as T;
}
