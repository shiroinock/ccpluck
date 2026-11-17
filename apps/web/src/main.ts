import type { PostMeta, RiskLevel } from "@ccpick/core";
import {
  buildBundle,
  buildModel,
  buildPost,
  filterRows,
  highlightSegments,
  parseInput,
  rowLabel,
  rowValueText,
  selectWhere,
  summarize,
  toJsonText,
  type Filter,
  type Model,
  type Row,
} from "./model.js";
import { SAMPLE } from "./sample.js";

// ---------------------------------------------------------------------------
// 状態（保存しない。リロードすると消える）

const state = {
  text: "",
  model: undefined as Model | undefined,
  mask: true,
  publicEnv: new Set<string>(),
  selected: new Set<string>(),
  notes: {} as Record<string, string>,
  filter: { risk: "all", query: "", onlySelected: false } as Filter,
  output: "bundle" as "bundle" | "post",
  meta: { title: "", os: "macos", tags: "" },
};

// ---------------------------------------------------------------------------
// DOM

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const input = $<HTMLTextAreaElement>("input");
const inputStatus = $("input-status");
const rowsEl = $("rows");
const summaryEl = $("summary");
const openBundle = $<HTMLButtonElement>("open-bundle");
const openPost = $<HTMLButtonElement>("open-post");
const dialog = $<HTMLDialogElement>("output");

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, string | boolean | undefined> = {},
  ...children: (Node | string | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === false) continue;
    if (k === "class") el.className = String(v);
    else if (k === "text") el.textContent = String(v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children) if (c !== undefined && c !== false) el.append(c);
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
// 入力

function load(text: string): void {
  state.text = text;
  if (input.value !== text) input.value = text;
  recompute();
}

function recompute(): void {
  const parsed = parseInput(state.text);
  if (!parsed.ok) {
    state.model = undefined;
    inputStatus.className = state.text.trim() ? "input-status is-error" : "input-status";
    inputStatus.textContent = state.text.trim() ? parsed.error : "";
    renderAll();
    return;
  }
  // env のキーが変わったら、なくなったキーの公開許可を外す
  state.model = buildModel(parsed.settings, { mask: state.mask, publicEnv: [...state.publicEnv] });
  const keys = new Set(state.model.rows.map((r) => r.key));
  state.selected = new Set([...state.selected].filter((k) => keys.has(k)));
  const unknown = parsed.warnings.filter((w) => w.code === "unknown-key").length;
  inputStatus.className = "input-status is-ok";
  inputStatus.textContent =
    `${state.model.rows.length} 項目を読み取りました` + (unknown > 0 ? `（スキーマにないキー ${unknown} 件）` : "");
  renderAll();
}

input.addEventListener("input", () => {
  state.text = input.value;
  recompute();
});

$<HTMLInputElement>("file").addEventListener("change", async (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (f) load(await f.text());
});
input.addEventListener("dragover", (e) => {
  e.preventDefault();
  input.classList.add("is-drop");
});
input.addEventListener("dragleave", () => input.classList.remove("is-drop"));
input.addEventListener("drop", async (e) => {
  e.preventDefault();
  input.classList.remove("is-drop");
  const f = e.dataTransfer?.files[0];
  if (f) load(await f.text());
});
$("sample").addEventListener("click", () => load(SAMPLE));
$("clear").addEventListener("click", () => {
  state.selected.clear();
  state.notes = {};
  state.publicEnv.clear();
  load("");
  input.focus();
});

$<HTMLInputElement>("mask").addEventListener("change", (e) => {
  state.mask = (e.target as HTMLInputElement).checked;
  recompute();
});

// ---------------------------------------------------------------------------
// マスク設定の表示

function renderMaskPanel(): void {
  const envEl = $("env-public");
  const findingsEl = $("findings");
  envEl.replaceChildren();
  findingsEl.replaceChildren();
  const m = state.model;
  if (!m || !state.mask) return;

  if (m.envKeys.length > 0) {
    envEl.append(
      h("p", { class: "sub-title", text: "値を公開する env" }),
      h("p", { class: "hint-text", text: "env の値は既定で非公開です。公開してよいものだけ選んでください。" }),
      ...m.envKeys.map((k) => {
        const cb = h("input", { type: "checkbox", "data-env": k, checked: state.publicEnv.has(k) });
        cb.addEventListener("change", () => {
          if (cb.checked) state.publicEnv.add(k);
          else state.publicEnv.delete(k);
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
// 項目の一覧

function renderRows(): void {
  const m = state.model;
  if (!m) {
    rowsEl.replaceChildren(
      h("p", { class: "empty", text: "左に settings.json を貼り付けると、ここに項目が並びます。" }),
    );
    return;
  }
  const rows = filterRows(m.rows, state.filter, state.selected);
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
  const id = `row-${encodeURIComponent(row.key)}`;
  const cb = h("input", { type: "checkbox", id, class: "row-check", checked: state.selected.has(row.key) });
  const li = h("li", { class: `row risk-${row.risk.level}${state.selected.has(row.key) ? " is-selected" : ""}` });
  cb.addEventListener("change", () => {
    if (cb.checked) state.selected.add(row.key);
    else state.selected.delete(row.key);
    li.classList.toggle("is-selected", cb.checked);
    renderSummary();
  });

  const value = rowValueText(row);
  const reasons = row.risk.matched.filter((m) => m.level === row.risk.level);
  const note = h("input", {
    type: "text",
    class: "note",
    placeholder: "なぜこう設定したか（任意）",
    "aria-label": "この項目の注釈",
    value: state.notes[row.key] ?? "",
  });
  note.addEventListener("input", () => {
    state.notes[row.key] = note.value;
  });

  const kindText = row.item.kind === "hook" ? `${row.item.hook?.event} hook` : undefined;
  li.append(
    h("span", { class: "gutter", "aria-hidden": "true" }),
    cb,
    h(
      "div",
      { class: "row-body" },
      h(
        "label",
        { class: "row-head", for: id },
        h("span", { class: `badge badge-${row.risk.level}`, text: RISK_LABEL[row.risk.level] }),
        kindText && h("span", { class: "kind", text: kindText }),
        h("code", { class: "row-label" }, highlighted(rowLabel(row))),
      ),
      value !== undefined && h("pre", { class: "row-value" }, highlighted(value)),
      reasons.length > 0 && row.risk.level !== "low" && h("p", { class: "reason", text: reasons.map((r) => r.reason).join(" / ") }),
      row.hasMasked && h("p", { class: "flag", text: "マスク値を含みます。取り込む人は値を入力するか、この項目をスキップします。" }),
      row.deps.length > 0 &&
        h("p", { class: "flag", text: `参照しているファイル: ${row.deps.map((d) => d.path).join(", ")}（同梱されません）` }),
      row.description && h("p", { class: "description", text: row.description, title: row.description }),
      note,
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
    const m = state.model;
    if (!m) return;
    const kind = b.dataset.bulk;
    if (kind === "none") state.selected.clear();
    else if (kind === "low") for (const k of selectWhere(m.rows, (r) => r.risk.level === "low")) state.selected.add(k);
    else for (const r of filterRows(m.rows, state.filter, state.selected)) state.selected.add(r.key);
    renderRows();
    renderSummary();
  }),
);

// ---------------------------------------------------------------------------
// 選択の集計と書き出し

function renderSummary(): void {
  const m = state.model;
  const s = m ? summarize(m.rows, state.selected) : { selected: 0, high: 0, masked: 0 };
  summaryEl.replaceChildren();
  if (s.selected === 0) {
    summaryEl.textContent = m ? "項目を選んでください" : "settings.json を貼り付けてください";
  } else {
    summaryEl.append(h("strong", { text: `${s.selected} 項目を選択中` }));
    if (s.high > 0) summaryEl.append(h("span", { class: "summary-high", text: `high ${s.high} 件` }));
    if (s.masked > 0) summaryEl.append(h("span", { class: "muted", text: `マスク値を含む ${s.masked} 件` }));
  }
  openBundle.disabled = s.selected === 0;
  openPost.disabled = s.selected === 0 || !state.mask;
  openPost.title = state.mask ? "" : "投稿用に書き出すにはマスクを有効にしてください";
}

function renderAll(): void {
  renderMaskPanel();
  renderRows();
  renderSummary();
}

let outputText = "";
let outputName = "";

function renderOutput(): void {
  const m = state.model;
  if (!m) return;
  const metaEl = $("output-meta");
  const noteEl = $("output-note");
  const pre = $("output-json");
  metaEl.replaceChildren();
  noteEl.className = "output-note";

  if (state.output === "bundle") {
    $("output-title").textContent = "取り込み用に書き出す";
    outputName = "ccpick-bundle.json";
    outputText = toJsonText(buildBundle(m.rows, state.selected, state.notes));
    noteEl.replaceChildren(
      "保存したファイルを、取り込む側のマシンで次のコマンドに渡します。high リスクの項目は適用前に内容の確認を求められます。",
      h("code", { class: "command", text: `npx ccpick apply ${outputName}` }),
    );
    if (!state.mask) {
      noteEl.classList.add("is-warning");
      noteEl.prepend(h("strong", { text: "マスクしていません。" }), " 秘密の値が含まれていないか確認してから共有してください。");
    }
  } else {
    $("output-title").textContent = "投稿用に書き出す";
    outputName = "ccpick-post.json";
    const title = h("input", { type: "text", value: state.meta.title, "aria-label": "タイトル", placeholder: "タイトル（任意）" });
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
    noteEl.textContent = "マスク済みの設定・注釈・メタ情報をまとめたものです。ライセンスは CC0-1.0 です。";
    renderPostJson();
    return;
  }
  pre.replaceChildren(highlighted(outputText));
}

function renderPostJson(): void {
  const m = state.model!;
  const pre = $("output-json");
  const meta: PostMeta = {
    os: state.meta.os as PostMeta["os"],
    tags: state.meta.tags.split(",").map((t) => t.trim()).filter(Boolean),
  };
  if (state.meta.title.trim()) meta.title = state.meta.title.trim();
  try {
    outputText = toJsonText(buildPost(m.rows, state.selected, state.notes, meta, [...state.publicEnv]));
    pre.replaceChildren(highlighted(outputText));
    $<HTMLButtonElement>("download").disabled = false;
    $<HTMLButtonElement>("copy").disabled = false;
  } catch (e) {
    outputText = "";
    pre.textContent = (e as Error).message;
    $<HTMLButtonElement>("download").disabled = true;
    $<HTMLButtonElement>("copy").disabled = true;
  }
}

function openOutput(kind: "bundle" | "post"): void {
  state.output = kind;
  $<HTMLButtonElement>("download").disabled = false;
  $<HTMLButtonElement>("copy").disabled = false;
  $("copy-status").textContent = "";
  renderOutput();
  dialog.showModal();
}
openBundle.addEventListener("click", () => openOutput("bundle"));
openPost.addEventListener("click", () => openOutput("post"));

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

renderAll();
