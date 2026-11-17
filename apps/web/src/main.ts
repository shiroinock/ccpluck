import type { PostMeta, RiskLevel } from "@ccpluck/core";
import {
  attentionFor,
  buildBundle,
  buildModel,
  buildPost,
  filterRows,
  highlightSegments,
  parseInput,
  parseSource,
  rowLabel,
  rowValueText,
  selectWhere,
  summarize,
  timelineState,
  toJsonText,
  type Decision,
  type Filter,
  type Model,
  type Purpose,
  type Row,
  type Source,
} from "./model.js";
import { SAMPLE, SAMPLE_POST } from "./sample.js";

// ---------------------------------------------------------------------------
// 状態（保存しない。リロードすると消える）

/** 目的ごとの作業状態。「もらう」と「公開する」は別々に持つ */
interface Session {
  text: string;
  model: Model | undefined;
  source: Source | undefined;
  selected: Set<string>;
  /** 入れないと決めた項目 */
  rejected: Set<string>;
  /** タイムラインで決めた順 */
  log: string[];
  /** あとで回しにした順 */
  deferred: string[];
  /** 自分で書いた理由（公開する側） */
  notes: Record<string, string>;
  publicEnv: Set<string>;
}

const newSession = (): Session => ({
  text: "",
  model: undefined,
  source: undefined,
  selected: new Set(),
  rejected: new Set(),
  log: [],
  deferred: [],
  notes: {},
  publicEnv: new Set(),
});

const state = {
  purpose: "pick" as Purpose,
  sessions: { pick: newSession(), publish: newSession() } as Record<Purpose, Session>,
  mineText: "",
  view: "timeline" as "timeline" | "list",
  filter: { risk: "all", query: "", onlySelected: false } as Filter,
  meta: { title: "", os: "macos", tags: "" },
};
const cur = () => state.sessions[state.purpose];

/** 目的ごとの言葉づかい。同じ操作は最後まで同じ名前で呼ぶ */
const WORDS = {
  pick: {
    inputTitle: "もらう設定",
    placeholder: "誰かが公開した投稿（ccpluck の JSON）か、settings.json をそのまま貼り付けてください",
    sample: "サンプルの投稿を読み込む",
    yes: "もらう",
    no: "もらわない",
    empty: "左に誰かの投稿を貼り付けると、あなたに役立ちそうな項目から順に出てきます。",
    output: "取り込み用に書き出す",
    summary: (n: number) => `${n} 件をもらう`,
    endNote: "下の「取り込み用に書き出す」で保存し、手元で npx ccpluck apply に渡すと settings.json に入ります。",
    hint: {
      timeline: "あなたに足りない項目、作者が理由を書いている項目から順に 1 件ずつ出します。",
      list: "投稿の項目を種類ごとに並べます。自分で探して選べます。",
    },
  },
  publish: {
    inputTitle: "自分の settings.json",
    placeholder: "~/.claude/settings.json の中身を貼り付けるか、ファイルをここにドロップしてください",
    sample: "サンプルを読み込む",
    yes: "公開する",
    no: "公開しない",
    empty: "左に自分の settings.json を貼り付けると、公開前に確かめるべき項目から順に出てきます。",
    output: "投稿用に書き出す",
    summary: (n: number) => `${n} 件を公開する`,
    endNote: "下の「投稿用に書き出す」で、マスク済みの設定と理由をまとめた投稿を保存できます。",
    hint: {
      timeline: "マスクした値や high リスクなど、公開前に確かめるべき項目から順に 1 件ずつ出します。",
      list: "すべての項目を種類ごとに並べます。自分で探して選べます。",
    },
  },
} as const;
const words = () => WORDS[state.purpose];

// ---------------------------------------------------------------------------
// DOM

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const input = $<HTMLTextAreaElement>("input");
const mineInput = $<HTMLTextAreaElement>("mine");
const rowsEl = $("rows");
const timelineEl = $("timeline");
const summaryEl = $("summary");
const openOutputBtn = $<HTMLButtonElement>("open-output");
const dialog = $<HTMLDialogElement>("output");

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, string | boolean | undefined> = {},
  ...children: (Node | string | undefined | false | null)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === false) continue;
    if (k === "class") el.className = String(v);
    else if (k === "text") el.textContent = String(v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children) if (c !== undefined && c !== false && c !== null) el.append(c);
  return el;
}

/** マスク値・ヒントを強調した文字列 */
function highlighted(text: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  for (const seg of highlightSegments(text)) {
    if (seg.kind === "plain") frag.append(seg.text);
    else frag.append(h("mark", { class: seg.kind === "masked" ? "mark-masked" : "mark-hint", title: seg.title, text: seg.text }));
  }
  return frag;
}

const RISK_LABEL: Record<RiskLevel, string> = { high: "high", medium: "medium", low: "low" };

// ---------------------------------------------------------------------------
// 入力と再計算

function setStatus(el: HTMLElement, kind: "ok" | "error" | "", text: string): void {
  el.className = `input-status${kind ? ` is-${kind}` : ""}`;
  el.textContent = text;
}

function recompute(): void {
  const s = cur();
  const status = $("input-status");
  s.model = undefined;
  s.source = undefined;
  if (s.text.trim() === "") {
    setStatus(status, "", "");
    renderAll();
    return;
  }
  if (state.purpose === "pick") {
    const r = parseSource(s.text);
    if (!r.ok) {
      setStatus(status, "error", r.error);
      renderAll();
      return;
    }
    s.source = r.source;
    const mine = parseMine();
    s.model = buildModel(r.source.settings, {
      mask: false,
      publicEnv: [],
      authorNotes: r.source.notes,
      ...(mine ? { mine } : {}),
    });
    const notes = s.model.rows.filter((x) => x.authorWhy).length;
    setStatus(
      status,
      "ok",
      `${s.model.rows.length} 項目を読み取りました` +
        (r.source.isPost ? `（作者の理由つき ${notes} 件）` : "（settings.json として読み込み。理由はありません）"),
    );
  } else {
    const r = parseInput(s.text);
    if (!r.ok) {
      setStatus(status, "error", r.error);
      renderAll();
      return;
    }
    s.model = buildModel(r.settings, { mask: true, publicEnv: [...s.publicEnv] });
    const unknown = r.warnings.filter((w) => w.code === "unknown-key").length;
    setStatus(status, "ok", `${s.model.rows.length} 項目を読み取りました` + (unknown > 0 ? `（スキーマにないキー ${unknown} 件）` : ""));
  }
  // 項目が変わったら、なくなった項目の状態を捨てる
  const keys = new Set(s.model.rows.map((r) => r.key));
  s.selected = new Set([...s.selected].filter((k) => keys.has(k)));
  s.rejected = new Set([...s.rejected].filter((k) => keys.has(k)));
  s.log = s.log.filter((k) => keys.has(k));
  s.deferred = s.deferred.filter((k) => keys.has(k));
  renderAll();
}

/** 自分の settings.json（もらう側の比較用）。空や不正なら undefined */
function parseMine() {
  const status = $("mine-status");
  if (state.mineText.trim() === "") {
    setStatus(status, "", "");
    return undefined;
  }
  const r = parseInput(state.mineText);
  if (!r.ok) {
    setStatus(status, "error", `${r.error}（比べずに表示しています）`);
    return undefined;
  }
  setStatus(status, "ok", "あなたの設定と比べています");
  return r.settings;
}

function load(text: string): void {
  cur().text = text;
  input.value = text;
  recompute();
}

input.addEventListener("input", () => {
  cur().text = input.value;
  recompute();
});
mineInput.addEventListener("input", () => {
  state.mineText = mineInput.value;
  if (state.purpose === "pick") recompute();
});

$<HTMLInputElement>("file").addEventListener("change", async (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (f) load(await f.text());
});
for (const area of [input, mineInput]) {
  area.addEventListener("dragover", (e) => {
    e.preventDefault();
    area.classList.add("is-drop");
  });
  area.addEventListener("dragleave", () => area.classList.remove("is-drop"));
  area.addEventListener("drop", async (e) => {
    e.preventDefault();
    area.classList.remove("is-drop");
    const f = e.dataTransfer?.files[0];
    if (!f) return;
    const text = await f.text();
    if (area === input) load(text);
    else {
      state.mineText = text;
      mineInput.value = text;
      recompute();
    }
  });
}
$("sample").addEventListener("click", () => load(state.purpose === "pick" ? SAMPLE_POST : SAMPLE));
$("clear").addEventListener("click", () => {
  state.sessions[state.purpose] = newSession();
  load("");
  input.focus();
});

// ---------------------------------------------------------------------------
// 目的の切り替え（もらう ⇄ 公開する）

function renderPurpose(): void {
  const isPick = state.purpose === "pick";
  $("purpose-pick").setAttribute("aria-selected", String(isPick));
  $("purpose-publish").setAttribute("aria-selected", String(!isPick));
  $("input-title").textContent = words().inputTitle;
  input.placeholder = words().placeholder;
  input.value = cur().text;
  $("sample").textContent = words().sample;
  $("mine-panel").hidden = !isPick;
  $("mask-options").hidden = isPick;
  openOutputBtn.textContent = words().output;
}

function setPurpose(p: Purpose): void {
  if (state.purpose === p) return;
  state.purpose = p;
  renderPurpose();
  recompute();
}
$("purpose-pick").addEventListener("click", () => setPurpose("pick"));
$("purpose-publish").addEventListener("click", () => setPurpose("publish"));

// ---------------------------------------------------------------------------
// マスク設定（公開する側）

function renderMaskPanel(): void {
  const envEl = $("env-public");
  const findingsEl = $("findings");
  envEl.replaceChildren();
  findingsEl.replaceChildren();
  const s = cur();
  const m = s.model;
  if (!m || state.purpose !== "publish") return;

  if (m.envKeys.length > 0) {
    envEl.append(
      h("p", { class: "sub-title", text: "値を公開する env" }),
      h("p", { class: "hint-text", text: "env の値は既定で非公開です。公開してよいものだけ選んでください。" }),
      ...m.envKeys.map((k) => {
        const cb = h("input", { type: "checkbox", checked: s.publicEnv.has(k) });
        cb.addEventListener("change", () => {
          if (cb.checked) s.publicEnv.add(k);
          else s.publicEnv.delete(k);
          recompute();
        });
        return h("label", { class: "check small" }, cb, h("code", { text: k }));
      }),
    );
  }

  const masked = m.findings.filter((f) => f.action === "masked").length;
  const replaced = m.findings.filter((f) => f.action === "replaced").length;
  const hints = m.findings.filter((f) => f.action === "highlight");
  findingsEl.append(
    h(
      "ul",
      { class: "tally" },
      h("li", {}, h("strong", { text: String(masked) }), " 件の値をマスク"),
      h("li", {}, h("strong", { text: String(replaced) }), " 件のパスを ~ に置換"),
      h("li", {}, h("strong", { text: String(hints.length) }), " 件の確認してほしい箇所"),
    ),
  );
  if (hints.length > 0) {
    findingsEl.append(
      h(
        "ul",
        { class: "hint-list" },
        ...hints.map((f) => h("li", {}, h("mark", { class: "mark-hint", text: f.match ?? "" }), " ", h("span", { class: "muted", text: f.reason }))),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// 投稿の見出し（もらう側）

function renderPostHeader(): void {
  const el = $("post-header");
  const src = cur().source;
  if (state.purpose !== "pick" || !src?.isPost) {
    el.hidden = true;
    el.replaceChildren();
    return;
  }
  const meta = src.meta ?? {};
  el.hidden = false;
  el.replaceChildren(
    h("p", { class: "post-title", text: meta.title || "タイトルのない投稿" }),
    h(
      "p",
      { class: "post-meta" },
      meta.os && h("span", { text: meta.os }),
      ...(meta.tags ?? []).map((t) => h("span", { class: "tag", text: `#${t}` })),
      meta.license && h("span", { class: "muted", text: meta.license }),
    ),
  );
}

// ---------------------------------------------------------------------------
// 決定（タイムラインと一覧で共有する）

function decide(key: string, d: Decision | undefined): void {
  const s = cur();
  s.selected.delete(key);
  s.rejected.delete(key);
  s.log = s.log.filter((k) => k !== key);
  s.deferred = s.deferred.filter((k) => k !== key);
  if (d === "in") s.selected.add(key);
  if (d === "out") s.rejected.add(key);
  if (d) s.log.push(key);
}

function defer(key: string): void {
  const s = cur();
  s.deferred = [...s.deferred.filter((k) => k !== key), key];
}

/** 自分の今の値との比較（もらう側） */
function compareLine(row: Row): HTMLElement | undefined {
  const m = row.mine;
  if (!m) return undefined;
  if (m.kind === "new") return h("p", { class: "compare compare-new", text: "あなたの settings.json にはありません。もらうと追加されます。" });
  if (m.kind === "same") return h("p", { class: "compare compare-same", text: "同じ設定をすでに持っています。" });
  const mineText = typeof m.value === "string" ? m.value : JSON.stringify(m.value, null, 2);
  return h(
    "div",
    { class: "compare compare-differs" },
    h("p", { text: "あなたの今の値と違います。もらうと置き換わります（取り込むときにもう一度確認されます）。" }),
    h("pre", { class: "row-value row-value-mine" }, h("span", { class: "value-label", text: "あなたの値" }), "\n", highlighted(mineText)),
  );
}

/** 作者の理由（もらう側の主役） */
function authorWhy(row: Row, big = false): HTMLElement | undefined {
  if (!row.authorWhy) return undefined;
  return h("blockquote", { class: `author-why${big ? " is-big" : ""}` }, h("p", { text: row.authorWhy }));
}

/** 自分で書く理由（公開する側） */
function noteInput(row: Row, big = false): HTMLElement {
  const s = cur();
  const id = `note-${encodeURIComponent(row.key)}-${big ? "card" : "row"}`;
  const note = h("input", {
    id,
    type: "text",
    class: `note${big ? " is-big" : ""}`,
    placeholder: big ? "例: ほかの人が真似するときに知っておいてほしいこと" : "なぜこう設定したか（任意）",
    value: s.notes[row.key] ?? "",
  });
  note.addEventListener("input", () => {
    s.notes[row.key] = note.value;
  });
  return h("div", { class: "note-field" }, h("label", { for: id, class: "note-label", text: "なぜこう設定したか（投稿に載ります）" }), note);
}

function valueAndFlags(row: Row): (Node | undefined | false)[] {
  const value = rowValueText(row);
  const reasons = row.risk.matched.filter((m) => m.level === row.risk.level);
  return [
    value !== undefined && h("pre", { class: "row-value" }, highlighted(value)),
    reasons.length > 0 && row.risk.level !== "low" && h("p", { class: "reason", text: reasons.map((r) => r.reason).join(" / ") }),
    row.hasMasked &&
      h(
        "p",
        { class: "flag" },
        state.purpose === "pick"
          ? "マスクされた値を含みます。取り込むときに自分の値を入力するか、この項目を飛ばします。"
          : "マスク値を含みます。取り込む人は値を入力するか、この項目をスキップします。",
      ),
    row.deps.length > 0 && h("p", { class: "flag", text: `参照しているファイル: ${row.deps.map((d) => d.path).join(", ")}（同梱されません）` }),
    row.description ? h("p", { class: "description", text: row.description, title: row.description }) : undefined,
  ];
}

function itemHead(row: Row, forId?: string): HTMLElement {
  const kindText = row.item.kind === "hook" ? `${row.item.hook?.event} hook` : row.group;
  return h(
    forId ? "label" : "div",
    { class: "row-head", ...(forId ? { for: forId } : {}) },
    h("span", { class: `badge badge-${row.risk.level}`, text: RISK_LABEL[row.risk.level] }),
    h("span", { class: "kind", text: kindText }),
    h("code", { class: "row-label" }, highlighted(rowLabel(row))),
  );
}

// ---------------------------------------------------------------------------
// 表示の切り替え（順に見る ⇄ 一覧から選ぶ）。状態は共有する

function renderView(): void {
  const isTimeline = state.view === "timeline";
  $("view-timeline").setAttribute("aria-selected", String(isTimeline));
  $("view-list").setAttribute("aria-selected", String(!isTimeline));
  $("view-hint").textContent = words().hint[state.view];
  timelineEl.hidden = !isTimeline;
  rowsEl.hidden = isTimeline;
  $("list-controls").hidden = isTimeline;
  if (isTimeline) renderTimeline();
  else renderRows();
}

$("view-timeline").addEventListener("click", () => {
  state.view = "timeline";
  renderView();
});
$("view-list").addEventListener("click", () => {
  state.view = "list";
  renderView();
});

// ---------------------------------------------------------------------------
// 順に見る（システムが次に見るものを出す）

function act(d: Decision | "later"): void {
  const s = cur();
  if (!s.model) return;
  const t = timelineState(s.model.rows, s.selected, s.rejected, s.log, s.deferred, state.purpose);
  if (!t.current) return;
  if (d === "later") defer(t.current.key);
  else decide(t.current.key, d);
  renderTimeline(true);
  renderSummary();
}

function renderTimeline(moved = false): void {
  const s = cur();
  const m = s.model;
  if (!m) {
    timelineEl.replaceChildren(h("p", { class: "empty", text: words().empty }));
    return;
  }
  const t = timelineState(m.rows, s.selected, s.rejected, s.log, s.deferred, state.purpose);
  const decided = t.done.filter((d) => !t.already.includes(d.row)).length;
  const pct = Math.round((Math.min(decided, t.total) / Math.max(t.total, 1)) * 100);

  const nodes: Node[] = [];

  // 進み具合（終わりがあることを見せる）
  nodes.push(
    h(
      "div",
      { class: "progress" },
      h("span", { class: "progress-text", text: `${Math.min(decided, t.total)} / ${t.total} 件を確認` }),
      h(
        "span",
        { class: "progress-bar", role: "progressbar", "aria-label": "確認した割合", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(pct) },
        h("span", { class: "progress-fill", "data-pct": String(pct) }),
      ),
    ),
  );

  // 済み（決めた順に積む。押すと決め直せる）
  if (t.done.length > 0) {
    nodes.push(
      h(
        "ol",
        { class: "rail rail-done", "aria-label": "決めた項目" },
        ...t.done.map(({ row, decision }) => {
          const btn = h(
            "button",
            { type: "button", class: `done-item is-${decision}`, title: "押すと決め直します" },
            h("span", { class: "done-mark", text: decision === "in" ? words().yes : words().no }),
            h("code", { class: "done-label" }, highlighted(rowLabel(row))),
          );
          btn.addEventListener("click", () => {
            decide(row.key, undefined);
            renderTimeline(true);
            renderSummary();
          });
          return h("li", { class: `rail-node is-${decision}` }, btn);
        }),
      ),
    );
  }

  if (t.current) {
    nodes.push(renderCard(t.current, moved));

    // このあと（薄く、数件だけ見せる）
    const next = [...t.upcoming, ...t.deferred];
    if (next.length > 0) {
      const shown = next.slice(0, 3);
      nodes.push(
        h(
          "ol",
          { class: "rail rail-next", "aria-label": "このあと出る項目" },
          ...shown.map((r) =>
            h(
              "li",
              { class: "rail-node is-next" },
              h("span", { class: `badge badge-${r.risk.level}`, text: RISK_LABEL[r.risk.level] }),
              h("code", { class: "done-label" }, highlighted(rowLabel(r))),
              s.deferred.includes(r.key) && h("span", { class: "muted", text: "あとで回し" }),
            ),
          ),
          next.length > shown.length && h("li", { class: "rail-more", text: `ほか ${next.length - shown.length} 件` }),
        ),
      );
    }
    // 判断の要らない low をまとめて片づける近道
    const lows = [t.current, ...t.upcoming, ...t.deferred].filter((r) => r.risk.level === "low" && !r.hasMasked);
    if (lows.length > 1) {
      const bulk = h("button", { type: "button", class: "link", text: `残りの low ${lows.length} 件をまとめて${words().yes}` });
      bulk.addEventListener("click", () => {
        for (const r of lows) decide(r.key, "in");
        renderTimeline(true);
        renderSummary();
      });
      nodes.push(h("p", { class: "timeline-bulk" }, bulk));
    }
  } else {
    const ins = t.done.filter((d) => d.decision === "in").length;
    nodes.push(
      h(
        "div",
        { class: "timeline-end", tabindex: "-1", id: "timeline-end" },
        h("p", { class: "end-title", text: "すべて確認しました" }),
        h("p", { text: `${words().yes} ${ins} 件、${words().no} ${t.done.length - ins} 件。${words().endNote}` }),
        h("p", { class: "muted", text: "決め直すときは、上に並んだ項目を押してください。" }),
      ),
    );
  }

  // すでに持っている（もらう側。出さずに脇へ寄せる）
  if (t.already.length > 0) {
    nodes.push(
      h(
        "details",
        { class: "already" },
        h("summary", { text: `すでに持っている設定 ${t.already.length} 件は飛ばしました` }),
        h("ul", {}, ...t.already.map((r) => h("li", {}, h("code", {}, highlighted(rowLabel(r)))))),
      ),
    );
  }

  timelineEl.replaceChildren(...nodes);
  // 進み具合の幅は CSSOM で設定する（CSP で style 属性を使わないため）
  const fill = timelineEl.querySelector<HTMLElement>(".progress-fill");
  if (fill) fill.style.width = `${fill.dataset.pct}%`;
  if (moved) {
    const target = document.getElementById("current-card") ?? document.getElementById("timeline-end");
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }
}

function renderCard(row: Row, moved: boolean): HTMLElement {
  const s = cur();
  const att = attentionFor(state.purpose, row);
  const isLater = s.deferred.includes(row.key);
  const btn = (label: string, key: string, cls: string, d: Decision | "later") => {
    const b = h("button", { type: "button", class: `button ${cls}`, "aria-keyshortcuts": key }, label, h("kbd", { text: key }));
    b.addEventListener("click", () => act(d));
    return b;
  };
  const isPick = state.purpose === "pick";
  return h(
    "article",
    {
      class: `card risk-${row.risk.level}${moved ? " is-arriving" : ""}`,
      "aria-label": `いま確認している項目: ${rowLabel(row)}`,
      tabindex: "-1",
      id: "current-card",
    },
    h("span", { class: "gutter", "aria-hidden": "true" }),
    h(
      "div",
      { class: "card-body" },
      h("p", { class: "card-why", text: isLater ? "あとで回しにした項目です" : att.reason }),
      isPick ? authorWhy(row, true) : undefined,
      itemHead(row),
      ...valueAndFlags(row),
      isPick ? compareLine(row) : noteInput(row, true),
      h(
        "div",
        { class: "card-actions" },
        btn(words().yes, "Y", "button-primary", "in"),
        btn(words().no, "N", "", "out"),
        btn("あとで", "L", "button-quiet", "later"),
      ),
    ),
  );
}

// キーボード: Y 決める / N 決めない / L あとで / Z ひとつ戻る
document.addEventListener("keydown", (e) => {
  if (state.view !== "timeline" || dialog.open || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target instanceof Element && e.target.closest("input, textarea, select, [contenteditable]")) return;
  const k = e.key.toLowerCase();
  if (k === "y") act("in");
  else if (k === "n") act("out");
  else if (k === "l") act("later");
  else if (k === "z") {
    const last = cur().log[cur().log.length - 1];
    if (!last) return;
    decide(last, undefined);
    renderTimeline(true);
    renderSummary();
  } else return;
  e.preventDefault();
});

// ---------------------------------------------------------------------------
// 一覧から選ぶ（自分で探して選ぶ）

function renderRows(): void {
  const s = cur();
  const m = s.model;
  if (!m) {
    rowsEl.replaceChildren(h("p", { class: "empty", text: words().empty }));
    return;
  }
  const rows = filterRows(m.rows, state.filter, s.selected);
  if (rows.length === 0) {
    rowsEl.replaceChildren(h("p", { class: "empty", text: "条件に合う項目はありません。" }));
    return;
  }
  const groups = new Map<string, Row[]>();
  for (const r of rows) groups.set(r.group, [...(groups.get(r.group) ?? []), r]);
  rowsEl.replaceChildren(
    ...[...groups].map(([name, list]) =>
      h("section", { class: "group" }, h("h3", { class: "group-title", text: name }), h("ul", { class: "group-list" }, ...list.map(renderRow))),
    ),
  );
}

function renderRow(row: Row): HTMLLIElement {
  const s = cur();
  const id = `row-${encodeURIComponent(row.key)}`;
  const cb = h("input", { type: "checkbox", id, class: "row-check", checked: s.selected.has(row.key) });
  const li = h("li", { class: `row risk-${row.risk.level}${s.selected.has(row.key) ? " is-selected" : ""}` });
  cb.addEventListener("change", () => {
    decide(row.key, cb.checked ? "in" : "out");
    li.classList.toggle("is-selected", cb.checked);
    renderSummary();
  });
  const isPick = state.purpose === "pick";
  li.append(
    h("span", { class: "gutter", "aria-hidden": "true" }),
    cb,
    h(
      "div",
      { class: "row-body" },
      itemHead(row, id),
      isPick ? authorWhy(row) : undefined,
      ...valueAndFlags(row),
      isPick ? compareLine(row) : noteInput(row),
    ),
  );
  return li;
}

document.querySelectorAll<HTMLInputElement>('input[name="risk"]').forEach((r) =>
  r.addEventListener("change", () => {
    state.filter.risk = r.value as Filter["risk"];
    renderRows();
  }),
);
$<HTMLInputElement>("query").addEventListener("input", (e) => {
  state.filter.query = (e.target as HTMLInputElement).value;
  renderRows();
});
$<HTMLInputElement>("only-selected").addEventListener("change", (e) => {
  state.filter.onlySelected = (e.target as HTMLInputElement).checked;
  renderRows();
});
document.querySelectorAll<HTMLButtonElement>("[data-bulk]").forEach((b) =>
  b.addEventListener("click", () => {
    const s = cur();
    const m = s.model;
    if (!m) return;
    const kind = b.dataset.bulk;
    if (kind === "none") for (const k of [...s.selected]) decide(k, undefined);
    else if (kind === "low") for (const k of selectWhere(m.rows, (r) => r.risk.level === "low")) decide(k, "in");
    else for (const r of filterRows(m.rows, state.filter, s.selected)) decide(r.key, "in");
    renderRows();
    renderSummary();
  }),
);

// ---------------------------------------------------------------------------
// 集計と書き出し

function renderSummary(): void {
  const s = cur();
  const m = s.model;
  const sum = m ? summarize(m.rows, s.selected) : { selected: 0, high: 0, masked: 0 };
  summaryEl.replaceChildren();
  if (!m) summaryEl.textContent = "";
  else if (sum.selected === 0) summaryEl.textContent = "まだ何も選んでいません";
  else {
    summaryEl.append(h("strong", { text: words().summary(sum.selected) }));
    if (sum.high > 0) summaryEl.append(h("span", { class: "summary-high", text: `high ${sum.high} 件` }));
    if (sum.masked > 0) summaryEl.append(h("span", { class: "muted", text: `マスク値を含む ${sum.masked} 件` }));
  }
  openOutputBtn.disabled = sum.selected === 0;
}

function renderAll(): void {
  renderMaskPanel();
  renderPostHeader();
  renderView();
  renderSummary();
}

let outputText = "";
let outputName = "";

function renderOutput(): void {
  const s = cur();
  const m = s.model;
  if (!m) return;
  const metaEl = $("output-meta");
  const noteEl = $("output-note");
  metaEl.replaceChildren();
  $("output-title").textContent = words().output;

  if (state.purpose === "pick") {
    outputName = "ccpluck-bundle.json";
    // 作者の理由も一緒に持っていく（apply の確認画面と履歴に出る）
    const notes = Object.fromEntries(m.rows.flatMap((r) => (r.authorWhy ? [[r.key, r.authorWhy]] : [])));
    const title = s.source?.meta?.title;
    outputText = toJsonText(buildBundle(m.rows, s.selected, notes, title ? { title } : undefined));
    noteEl.replaceChildren(
      h("p", { text: "保存したファイルを手元で次のコマンドに渡すと、選んだ項目だけがあなたの settings.json に入ります。high リスクの項目と、値が違う項目は適用前にもう一度確認されます。いつでも ccpluck undo で戻せます。" }),
      h("code", { class: "command", text: `npx ccpluck apply ${outputName}` }),
    );
    setOutputJson();
    return;
  }

  outputName = "ccpluck-post.json";
  const title = h("input", { type: "text", value: state.meta.title, "aria-label": "タイトル", placeholder: "タイトル（例: Web フロントエンド開発の設定）" });
  const os = h(
    "select",
    { "aria-label": "OS" },
    ...(["macos", "linux", "windows", "wsl", "other"] as const).map((o) => h("option", { value: o, selected: state.meta.os === o, text: o })),
  );
  const tags = h("input", { type: "text", value: state.meta.tags, "aria-label": "用途タグ", placeholder: "用途タグ（カンマ区切り）" });
  const update = () => {
    state.meta = { title: title.value, os: os.value, tags: tags.value };
    renderPostJson();
  };
  for (const el of [title, os, tags]) el.addEventListener("input", update);
  metaEl.append(title, os, tags);
  noteEl.replaceChildren(h("p", { text: "マスク済みの設定・理由・メタ情報をまとめた投稿です。ほかの人は「もらう」画面にこれを貼り付けて、欲しい項目だけを持っていけます。ライセンスは CC0-1.0 です。" }));
  renderPostJson();
}

function setOutputJson(error?: string): void {
  const pre = $("output-json");
  if (error) pre.textContent = error;
  else pre.replaceChildren(highlighted(outputText));
  $<HTMLButtonElement>("download").disabled = Boolean(error);
  $<HTMLButtonElement>("copy").disabled = Boolean(error);
}

function renderPostJson(): void {
  const s = cur();
  const meta: PostMeta = {
    os: state.meta.os as PostMeta["os"],
    tags: state.meta.tags.split(",").map((t) => t.trim()).filter(Boolean),
  };
  if (state.meta.title.trim()) meta.title = state.meta.title.trim();
  try {
    outputText = toJsonText(buildPost(s.model!.rows, s.selected, s.notes, meta, [...s.publicEnv]));
    setOutputJson();
  } catch (e) {
    outputText = "";
    setOutputJson((e as Error).message);
  }
}

openOutputBtn.addEventListener("click", () => {
  $("copy-status").textContent = "";
  renderOutput();
  dialog.showModal();
});
$("download").addEventListener("click", () => {
  const url = URL.createObjectURL(new Blob([outputText], { type: "application/json" }));
  const a = h("a", { href: url, download: outputName });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  $("copy-status").textContent = `${outputName} を保存しました`;
});
$("copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(outputText);
    $("copy-status").textContent = "コピーしました";
  } catch {
    $("copy-status").textContent = "コピーできませんでした。内容を選択してコピーしてください";
  }
});

renderPurpose();
renderAll();
