/**
 * 「公開する」側の判断を助ける純粋関数。
 * 自分の設定をマスクし、公開前に確かめるべき項目から 1 件ずつ出す。
 */
import { createPost, maskedItemPairs, type Notes, type PostMeta, type SharePost } from "./bundle.js";
import { compose, type Item } from "./items.js";
import { isPlainObject, walkStrings, type Settings } from "./json.js";
import { HINT_PATTERNS, containsMasked, maskSettings, type MaskFinding, type MaskOptions } from "./mask.js";
import type { Attention } from "./pick.js";
import { assessRisk, type RiskAssessment, type RiskLevel } from "./risk.js";

export interface Hint {
  match: string;
  reason: string;
}

/** 社内ホスト名など、マスクはしないが公開前に見てほしい箇所 */
export function hintsIn(item: Item): Hint[] {
  const out: Hint[] = [];
  for (const { value } of walkStrings(item.value)) {
    for (const p of HINT_PATTERNS) {
      const re = new RegExp(p.re.source, p.re.flags.includes("g") ? p.re.flags : `${p.re.flags}g`);
      for (const m of value.matchAll(re)) if (m[0]) out.push({ match: m[0], reason: p.reason });
    }
  }
  // 「domain:wiki.example.internal」と「wiki.example.internal」のように重なるものは、短い（具体的な）ほうだけ残す
  return out.filter(
    (h, i) => !out.some((o, j) => j !== i && o.match !== h.match && h.match.includes(o.match)) && out.findIndex((o) => o.match === h.match) === i,
  );
}

/**
 * 公開する側の順。公開して困るものを先に出す。
 * 1. マスクした値を含む  2. high  3. 確認してほしい箇所を含む  4. medium  5. low
 */
export function publishAttention(c: { hasMasked: boolean; risk: RiskLevel; hints: number }): Attention {
  if (c.hasMasked) return { rank: 0, reason: "マスクした値を含みます" };
  if (c.risk === "high") return { rank: 1, reason: "high リスクです" };
  if (c.hints > 0) return { rank: 2, reason: "社内のホスト名などを含みます" };
  if (c.risk === "medium") return { rank: 3, reason: "medium リスクです" };
  return { rank: 4, reason: "low リスクです" };
}

export interface PublishCandidate {
  /** マスク後の項目（公開されるもの） */
  item: Item;
  /** マスク前の項目 */
  original: Item;
  /** リスクはマスク前の値で判定する */
  risk: RiskAssessment;
  hasMasked: boolean;
  /** マスクで値が変わった */
  changedByMask: boolean;
  hints: Hint[];
  attention: Attention;
}

export interface PublishPlan {
  candidates: PublishCandidate[];
  findings: MaskFinding[];
  /** env のキー（値を公開するか選べるもの） */
  envKeys: string[];
}

/** 自分の設定をマスクし、公開前に確かめるべき順に並べる（同じ順位の中では settings.json に書かれた順） */
export function publishCandidates(settings: Settings, opts: MaskOptions = {}): PublishPlan {
  const m = maskSettings(settings, opts);
  const cands: { c: PublishCandidate; i: number }[] = [];
  maskedItemPairs(settings, m.settings).forEach(({ original, masked }, i) => {
    // マスクで他の項目と同じになった項目は投稿に書けないので外す
    if (!masked) return;
    const risk = assessRisk(original);
    const hasMasked = containsMasked(masked.value);
    const hints = hintsIn(masked);
    cands.push({
      c: {
        item: masked,
        original,
        risk,
        hasMasked,
        changedByMask: masked.id !== original.id || JSON.stringify(masked.value) !== JSON.stringify(original.value),
        hints,
        attention: publishAttention({ hasMasked, risk: risk.level, hints: hints.length }),
      },
      i,
    });
  });
  return {
    candidates: cands.sort((x, y) => x.c.attention.rank - y.c.attention.rank || x.i - y.i).map((x) => x.c),
    findings: m.findings,
    envKeys: isPlainObject(settings.env) ? Object.keys(settings.env) : [],
  };
}

/**
 * 選んだ項目から投稿を作る。notes はマスク後の項目 ID で書く。
 * マスク漏れがあれば createPost が例外を投げる。
 */
export function buildPublishPost(chosen: PublishCandidate[], notes: Notes, meta: PostMeta, opts: MaskOptions = {}): SharePost {
  const ids = new Set(chosen.map((c) => c.item.id));
  const own: Notes = {};
  for (const [id, n] of Object.entries(notes)) {
    if (!ids.has(id) || !n.why?.trim()) continue;
    Object.defineProperty(own, id, { value: { ...n, why: n.why.trim() }, enumerable: true, writable: true, configurable: true });
  }
  return createPost(compose(chosen.map((c) => c.item)), own, meta, opts);
}
