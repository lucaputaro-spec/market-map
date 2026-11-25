// Die Seite. Einzige Stelle, die lib/ aufruft. Regeln dazu:
// - Was an /api/step geht, kommt nur aus buildContext(). Was das Modell
//   antwortet, kommt nur über applyResult() in den Zustand.
// - Änderungen von Hand laufen über addItem/editItem/deleteItem/strikeSegment,
//   also durch dieselben Prüfungen.
// - Gespeichert wird nichts, alles liegt nur im Speicher dieser Seite.
// Inhalte werden nur als Text eingesetzt, nie als HTML.

import { aiResult, contextTooLarge, MAX_AI_CALLS_PER_SESSION } from "./lib/ai.js";
import { addItem, applyResult, approve, buildContext, canApprove, canRun, createState, deleteItem, editItem, strikeSegment } from "./lib/chain.js";
import { exportBlocker, toMarkdown } from "./lib/export.js";
import { TOPICS } from "./lib/quote.js";
import { OFFER_CATEGORIES, SIGNAL_TYPES } from "./lib/rules.js";
import { STEPS } from "./lib/types.js";

const TITLES = {
  1: ["Market research", "Facts about offering, customers and pricing. Each one quotes a fetched page word for word."],
  2: ["Segments", "Customer segments, best fit first. Strike the ones that do not fit; they leave all later steps."],
  3: ["Personas", "Up to 3 buyers per segment: job title, what they are measured on, everyday problems."],
  4: ["Data sources and signals", "Where to find these companies, and signals that they might buy now."],
  5: ["Keywords", "Filter keywords per segment for company and contact lists."],
  6: ["Offers and emails", "Up to 4 offers per segment with a cold email draft. Unproven numbers become {proof}."],
};
const STATUS = { empty: "Not generated", draft: "Draft, needs approval", approved: "Approved", stale: "Outdated" };
const TEST_CLAIM = "test claim: this company guarantees 300% more pipeline in 7 days";

const $ = (sel) => document.querySelector(sel);

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === "class") el.className = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "value") el.value = v;
    else if (k === "open" || k === "disabled" || k === "selected") el[k] = Boolean(v);
    else if (v !== undefined && v !== null && v !== false) el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false || kid === "") continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

/* ---------- Zustand, nur im Speicher ---------- */

let aiOn = false;
let state = null;
let busy = false;
let aiCalls = 0;
const errors = {};

/* ---------- Felder je Schritt ---------- */

const text = (key, label, wide = false) => ({ key, label, type: wide ? "area" : "text", wide });
const segField = { key: "segmentId", label: "Segment", type: "segment" };

function fieldsFor(n, kind) {
  if (n === 1) return [{ key: "url", label: "Page", type: "page" }, { key: "topic", label: "Topic", type: "select", options: TOPICS }, { key: "quote", label: "Quote (word for word from the page)", type: "area", wide: true }];
  if (n === 2) return [text("name", "Name"), text("industry", "Industry"), text("subIndustry", "Sub-industry"), text("why", "Why it fits", true)];
  if (n === 3) return [segField, text("title", "Job title"), { key: "measuredOn", label: "Measured on (one per line)", type: "lines" }, { key: "problems", label: "Problems (one per line)", type: "lines" }];
  if (n === 4 && kind === "source") return [segField, text("name", "Data source"), text("why", "Why", true)];
  if (n === 4) return [segField, { key: "type", label: "Signal type", type: "select", options: SIGNAL_TYPES }, text("description", "Description", true)];
  if (n === 5) return [segField, { key: "keywords", label: "Keywords (comma separated)", type: "commas", wide: true }];
  return [segField, { key: "category", label: "Category", type: "select", options: OFFER_CATEGORIES }, text("idea", "Idea", true), text("email.subject", "Email subject (max 10 words)"), { key: "email.body", label: "Email body (max 64 words)", type: "area", wide: true, rows: 5 }];
}

const getValue = (item, key) => key.split(".").reduce((o, k) => (o == null ? undefined : o[k]), item);

function control(field, value) {
  const id = `f-${Math.random().toString(36).slice(2)}`;
  let input;
  if (field.type === "area" || field.type === "lines") {
    input = h("textarea", { id, rows: field.rows || 2, value: Array.isArray(value) ? value.join("\n") : value ?? "" });
  } else if (field.type === "commas") {
    input = h("input", { id, value: Array.isArray(value) ? value.join(", ") : "" });
  } else if (field.type === "select" || field.type === "segment" || field.type === "page") {
    let options = field.options;
    if (field.type === "segment") options = state.steps[2].items.filter((s) => !s.struck).map((s) => [s.id, s.name]);
    if (field.type === "page") options = state.pages.map((p) => p.url);
    const pairs = options.map((o) => (Array.isArray(o) ? o : [o, o]));
    if (value && !pairs.some(([v]) => v === value)) pairs.unshift([value, `${value} (unknown)`]);
    input = h("select", { id }, pairs.map(([v, label]) => h("option", { value: v, selected: v === value }, label)));
  } else {
    input = h("input", { id, value: value ?? "" });
  }
  return { el: h("label", { for: id, class: field.wide ? "wide" : "" }, field.label, input), input };
}

function editor(n, item, kind) {
  const fields = fieldsFor(n, kind);
  const controls = fields.map((f) => ({ f, ...control(f, item ? getValue(item, f.key) : undefined) }));
  const read = () => {
    const patch = {};
    for (const { f, input } of controls) {
      let v = input.value;
      if (f.type === "lines") v = v.split("\n").map((x) => x.trim()).filter(Boolean);
      if (f.type === "commas") v = v.split(",").map((x) => x.trim()).filter(Boolean);
      if (f.key.startsWith("email.")) patch.email = { ...(patch.email || {}), [f.key.slice(6)]: v };
      else patch[f.key] = v;
    }
    if (kind) patch.kind = kind;
    return patch;
  };
  return { el: h("div", { class: "fields" }, controls.map((c) => c.el)), read };
}

/* ---------- Aktionen ---------- */

function update(next) {
  state = next;
  render();
}

async function fetchWebsite(event) {
  event.preventDefault();
  const domain = $("#domain").value.trim();
  if (!domain || !aiOn || busy) return;
  if (state && STEPS.some((n) => state.steps[n].status !== "empty") && !window.confirm("Start over? The current strategy is not saved.")) return;
  busy = true;
  $("#fetch-note").textContent = "Fetching…";
  render();
  try {
    const r = await fetch("/api/fetch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ domain }) });
    const body = await r.json().catch(() => null);
    if (r.status === 200 && body && Array.isArray(body.pages)) {
      state = createState(body.domain, body.pages);
      for (const n of STEPS) errors[n] = "";
      $("#fetch-note").textContent = `${body.pages.length} ${body.pages.length === 1 ? "page" : "pages"} fetched from ${body.domain}.`;
    } else {
      $("#fetch-note").textContent = body?.error || `Fetch failed (HTTP ${r.status}).`;
    }
  } catch {
    $("#fetch-note").textContent = "Fetch failed (network error).";
  }
  busy = false;
  render();
}

async function generate(n) {
  if (!state || busy || !canRun(state, n)) return;
  if (aiCalls >= MAX_AI_CALLS_PER_SESSION) {
    errors[n] = `AI limit reached (${MAX_AI_CALLS_PER_SESSION} calls per session). Reload the page to start a new session.`;
    render();
    return;
  }
  const ctx = buildContext(state, n);
  const tooLarge = contextTooLarge(ctx);
  if (tooLarge) {
    errors[n] = tooLarge;
    render();
    return;
  }
  aiCalls += 1;
  busy = true;
  errors[n] = "";
  render();
  let res = null;
  try {
    const r = await fetch("/api/step", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(ctx) });
    res = { status: r.status, body: await r.json().catch(() => null) };
  } catch {
    res = null;
  }
  const verdict = aiResult(res);
  if (verdict === "use") state = applyResult(state, n, res.body);
  else errors[n] = verdict;
  busy = false;
  render();
}

function download() {
  if (!state || exportBlocker(state)) return;
  const md = toMarkdown(state, { domain: state.domain, date: new Date().toISOString().slice(0, 10) });
  const url = URL.createObjectURL(new Blob([md], { type: "text/markdown;charset=utf-8" }));
  const name = `market-map-${state.domain}.md`;
  const a = h("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  $("#export-note").textContent = `${name} downloaded.`;
}

/* ---------- Anzeige ---------- */

const button = (label, onclick, enabled, ghost = false) => h("button", { type: "button", class: ghost ? "ghost" : "", disabled: busy || !enabled, onclick }, label);

function describe(item) {
  const o = item || {};
  const main = o.quote || o.name || o.title || o.description || o.idea || (Array.isArray(o.keywords) && o.keywords.join(", ")) || "";
  return typeof main === "string" && main ? main : JSON.stringify(o).slice(0, 120);
}

function droppedBlock(n, dropped) {
  if (!dropped.length) return null;
  const label = n === 1 ? `${dropped.length} statements dropped (no source on page)` : `${dropped.length} entries dropped by the checks`;
  return h(
    "details",
    null,
    h("summary", { class: "counter" }, label),
    h(
      "ul",
      { class: "dropped" },
      dropped.map((d) => h("li", null, d.item && d.item.source === "test" ? h("span", { class: "tag" }, "test claim") : null, ` ${d.reason}: ${d.detail}. `, h("q", null, describe(d.item)))),
    ),
  );
}

function segmentItem(item) {
  if (item.struck) {
    return h("li", { class: "item struck" }, h("p", { class: "title" }, item.name), h("p", { class: "hint" }, `Struck: ${item.strikeReason}`));
  }
  const ed = editor(2, item);
  const reason = h("input", { placeholder: "Reason (required)", "aria-label": `Reason to strike ${item.name}` });
  const strike = button("Strike segment", () => {
    const r = strikeSegment(state, item.id, reason.value);
    if ("error" in r) {
      errors[2] = r.error;
      render();
    } else update(r.state);
  }, false, true);
  reason.addEventListener("input", () => {
    strike.disabled = busy || !reason.value.trim();
  });
  return h(
    "li",
    { class: "item" },
    ed.el,
    h("div", { class: "row" }, button("Save", () => update(editItem(state, 2, item.id, ed.read())), true, true)),
    h("div", { class: "row" }, reason, strike),
  );
}

function itemRow(n, item) {
  if (n === 2) return segmentItem(item);
  const ed = editor(n, item, n === 4 ? item.kind : undefined);
  const tag = n === 4 ? h("p", { class: "hint" }, item.kind === "source" ? "Data source" : "Signal") : null;
  return h(
    "li",
    { class: "item" },
    tag,
    ed.el,
    h("div", { class: "row" }, button("Save", () => update(editItem(state, n, item.id, ed.read())), true, true), button("Delete", () => update(deleteItem(state, n, item.id)), true, true)),
  );
}

function addForm(n, kind, label) {
  if (n >= 3 && !state.steps[2].items.some((s) => !s.struck)) return null;
  const ed = editor(n, null, kind);
  return h("li", { class: "item add" }, h("h3", null, label), ed.el, h("div", { class: "row" }, button("Add", () => update(addItem(state, n, ed.read())), true, true)));
}

function panel(n) {
  const step = state.steps[n];
  const [title, about] = TITLES[n];
  const adds = n === 4 ? [addForm(4, "source", "Add data source"), addForm(4, "signal", "Add signal")] : [addForm(n, undefined, n === 1 ? "Add fact (needs page and quote)" : "Add entry")];
  return h(
    "section",
    { class: "card", "aria-labelledby": `step-${n}` },
    h("div", { class: "head" }, h("h2", { id: `step-${n}` }, `Step ${n}: ${title}`), h("span", { class: `status status-${step.status}` }, STATUS[step.status])),
    h("p", { class: "hint" }, about),
    step.status === "stale" ? h("p", { class: "banner", role: "status" }, "Outdated: an earlier step changed. Generate this step again, then approve it.") : null,
    h(
      "div",
      { class: "row" },
      button(step.status === "empty" ? "Generate" : "Generate again", () => generate(n), aiOn && canRun(state, n) && aiCalls < MAX_AI_CALLS_PER_SESSION),
      button("Approve", () => update(approve(state, n)), canApprove(state, n), true),
      n === 1 ? button("Verification check", () => update(addItem(state, 1, { url: state.pages[0]?.url, topic: "offering", quote: TEST_CLAIM }, "test")), state.pages.length > 0, true) : null,
    ),
    n === 1 ? h("p", { class: "hint" }, `Verification check adds an invented test claim (“${TEST_CLAIM}”). It must be dropped as not_on_page.`) : null,
    errors[n] ? h("p", { class: "error", role: "alert" }, errors[n]) : null,
    droppedBlock(n, step.dropped),
    h("ul", { class: "items" }, step.items.map((item) => itemRow(n, item)), step.status === "empty" ? null : adds),
  );
}

function render() {
  $("#domain").disabled = !aiOn || busy;
  $("#fetch").disabled = !aiOn || busy;
  $("#pages").replaceChildren(...(state ? state.pages.map((p) => h("li", null, p.url)) : []));
  $("#steps").replaceChildren(...(state ? STEPS.map(panel) : []));
  if (state) $("#steps").prepend(h("p", { class: "hint" }, `AI calls this session: ${aiCalls} of ${MAX_AI_CALLS_PER_SESSION}.`));
  const blocker = state ? exportBlocker(state) : "Fetch a website first.";
  $("#download").disabled = busy || Boolean(blocker);
  if (blocker) $("#export-note").textContent = blocker;
}

$("#domain-form").addEventListener("submit", fetchWebsite);
$("#download").addEventListener("click", download);

fetch("/api/status")
  .then((r) => r.json())
  .then((s) => {
    aiOn = s && s.ai === true;
  })
  .catch(() => {
    aiOn = false;
  })
  .finally(() => {
    $("#ai-off").hidden = aiOn;
    render();
  });
render();
