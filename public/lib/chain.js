// Die Kette der 6 Schritte. Zwei Stellen sind die einzigen Eingänge:
// - applyResult() ist der einzige Weg, auf dem eine Modellantwort in den
//   Zustand kommt. Dort laufen verifyFacts() und die Regeln aus rules.js.
// - buildContext() ist der einzige Weg vom Zustand in den Body von /api/step.
//   Dort fallen gestrichene Segmente heraus.
// Jede Funktion gibt einen neuen Zustand zurück und ändert den alten nicht.

import { verifyFacts } from "./quote.js";
import { checkOffer, cleanKeywords, isSignalType, SIGNAL_TYPES } from "./rules.js";
import { STEPS } from "./types.js";

/**
 * @typedef {import("./types.js").State} State
 * @typedef {import("./types.js").StepNo} StepNo
 * @typedef {import("./types.js").StepState} StepState
 * @typedef {import("./types.js").Page} Page
 * @typedef {import("./types.js").Item} Item
 * @typedef {import("./types.js").Fact} Fact
 * @typedef {import("./types.js").Segment} Segment
 * @typedef {import("./types.js").Persona} Persona
 * @typedef {import("./types.js").Source} Source
 * @typedef {import("./types.js").Signal} Signal
 * @typedef {import("./types.js").Keyword} Keyword
 * @typedef {import("./types.js").Offer} Offer
 * @typedef {import("./types.js").Claim} Claim
 * @typedef {import("./types.js").ClaimSource} ClaimSource
 * @typedef {import("./types.js").Dropped} Dropped
 * @typedef {import("./types.js").DropReason} DropReason
 * @typedef {Record<string, unknown>} Loose
 * @typedef {{
 *   step: StepNo, domain: string, pages?: Page[],
 *   facts?: { url: string, quote: string, topic: string }[],
 *   segments?: { id: string, name: string, industry: string, subIndustry: string, why: string }[],
 *   personas?: Persona[], signals?: (Source | Signal)[], keywords?: Keyword[]
 * }} Context
 */

const MAX_TEXT = 300;
const MAX_BODY = 1500;
const MAX_LIST = 8;
// Der Worker nimmt in Schritt 1 höchstens so viel Seitentext an. Hier schon
// kürzen, damit der Body unter seiner Größengrenze bleibt.
export const MAX_PAGE_TEXT_TOTAL = 16_000;
// Zusätzlich nach Bytes, wie sie im JSON-Body stehen: 16 000 CJK-Zeichen
// wären sonst rund 48 000 Byte und lägen über der Worker-Grenze von 40 000.
export const MAX_PAGE_TEXT_BYTES = 32_000;

const encoder = new TextEncoder();
/** @param {string} s */
const jsonBytes = (s) => encoder.encode(JSON.stringify(s)).length - 2;

/**
 * Längster Anfang von text, dessen JSON-Kodierung höchstens maxBytes hat.
 * @param {string} text @param {number} maxBytes
 */
function cutToBytes(text, maxBytes) {
  if (jsonBytes(text) <= maxBytes) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (jsonBytes(text.slice(0, mid)) <= maxBytes) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo);
}

/** @returns {StepState} */
const emptyStep = () => ({ status: "empty", items: [], dropped: [] });

/**
 * @param {string} domain
 * @param {Page[]} pages
 * @returns {State}
 */
export function createState(domain, pages) {
  return { domain, pages, seq: 1, steps: { 1: emptyStep(), 2: emptyStep(), 3: emptyStep(), 4: emptyStep(), 5: emptyStep(), 6: emptyStep() } };
}

/** @param {State} state @returns {State} */
const clone = (state) => structuredClone(state);

/** @param {State} state @param {StepNo} n */
export function canRun(state, n) {
  if (state.steps[n].status === "approved") return false;
  return n === 1 ? state.pages.length > 0 : state.steps[/** @type {StepNo} */ (n - 1)].status === "approved";
}

/**
 * Freigabe nur mit Inhalt: ein leerer Schritt würde den nächsten mit nichts
 * starten. In Schritt 2 zählen nur nicht gestrichene Segmente.
 * @param {State} state @param {StepNo} n
 */
export const hasUsable = (state, n) => (n === 2 ? segmentsOf(state).some((s) => !s.struck) : state.steps[n].items.length > 0);

/** @param {State} state @param {StepNo} n */
export const canApprove = (state, n) => state.steps[n].status === "draft" && hasUsable(state, n);

/** @param {State} state @param {StepNo} n */
export function approve(state, n) {
  if (!canApprove(state, n)) return state;
  const next = clone(state);
  next.steps[n].status = "approved";
  return next;
}

/**
 * Alle späteren Schritte mit Inhalt veralten. Mutiert next, nur intern.
 * @param {State} next
 * @param {StepNo} from erster Schritt, der veralten soll
 */
function staleFrom(next, from) {
  for (const k of STEPS) if (k >= from && next.steps[k].status !== "empty") next.steps[k].status = "stale";
}

/**
 * Sonst ginge: freigeben, danach alles löschen, und der nächste Schritt läuft leer.
 * Mutiert next, nur intern.
 * @param {State} next @param {StepNo} n
 */
function dropApprovalIfEmpty(next, n) {
  if (next.steps[n].status === "approved" && !hasUsable(next, n)) next.steps[n].status = "draft";
}

/** @param {unknown} v @param {number} [max] */
const text = (v, max = MAX_TEXT) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** @param {unknown} v */
const list = (v) => (Array.isArray(v) ? v.map((x) => text(x)).filter(Boolean).slice(0, MAX_LIST) : []);

/** @param {State} state */
const segmentsOf = (state) => /** @type {Segment[]} */ (state.steps[2].items);

/** @param {State} state */
const factsOf = (state) => /** @type {Fact[]} */ (state.steps[1].items);

/**
 * Prüft einen Eintrag der Schritte 2–6. Für 3–6 muss die segmentId zu einem
 * nicht gestrichenen Segment gehören.
 * @param {State} state
 * @param {StepNo} n
 * @param {Loose} raw
 * @param {string} id
 * @returns {{ item: Item } | { reason: DropReason, detail: string }}
 */
function checkItem(state, n, raw, id) {
  const bad = /** @param {string} what */ (what) => ({ reason: /** @type {DropReason} */ ("bad_shape"), detail: `missing ${what}` });
  if (n === 2) {
    const name = text(raw.name);
    if (!name) return bad("name");
    /** @type {Segment} */
    const seg = { id, name, industry: text(raw.industry), subIndustry: text(raw.subIndustry), why: text(raw.why) };
    return { item: seg };
  }

  const segmentId = text(raw.segmentId);
  const seg = segmentsOf(state).find((s) => s.id === segmentId);
  if (!seg) return { reason: "unknown_segment", detail: `segmentId ${JSON.stringify(raw.segmentId)} is not a segment from step 2` };
  if (seg.struck) return { reason: "struck_segment", detail: `segment “${seg.name}” was struck` };

  if (n === 3) {
    const title = text(raw.title);
    if (!title) return bad("title");
    return { item: { id, segmentId, title, measuredOn: list(raw.measuredOn), problems: list(raw.problems) } };
  }
  if (n === 4) {
    if (raw.kind === "source") {
      const name = text(raw.name);
      if (!name) return bad("name");
      return { item: { id, kind: "source", segmentId, name, why: text(raw.why) } };
    }
    if (!isSignalType(raw.type)) {
      return { reason: "unknown_signal_type", detail: `signal type ${JSON.stringify(raw.type)} is not one of ${SIGNAL_TYPES.join(", ")}` };
    }
    const description = text(raw.description);
    if (!description) return bad("description");
    return { item: { id, kind: "signal", segmentId, type: raw.type, description } };
  }
  if (n === 5) {
    const keywords = cleanKeywords(Array.isArray(raw.keywords) ? raw.keywords : []);
    if (!keywords.length) return { reason: "no_keywords", detail: "no keyword with 2–40 characters" };
    return { item: { id, segmentId, keywords } };
  }
  const idea = text(raw.idea);
  const email = /** @type {Loose} */ (raw.email ?? {});
  const subject = text(email.subject);
  const body = typeof email.body === "string" ? email.body.trim().slice(0, MAX_BODY) : "";
  if (!idea || !subject || !body) return bad("idea, subject or body");
  const r = checkOffer({ category: raw.category, idea, email: { subject, body } }, factsOf(state));
  if ("reason" in r) return r;
  return { item: { id, segmentId, category: r.category, idea: r.idea, email: r.email } };
}

/**
 * Prüft eine Liste roher Einträge für Schritt n. Schritt 1 läuft durch verifyFacts().
 * @param {State} next wird um die verbrauchten IDs weitergezählt
 * @param {StepNo} n
 * @param {unknown[]} raws
 * @param {ClaimSource} source
 * @returns {{ items: Item[], dropped: Dropped[] }}
 */
function checkAll(next, n, raws, source) {
  if (n === 1) {
    /** @type {Claim[]} */
    const claims = raws.map((r) => {
      const o = /** @type {Loose} */ (r ?? {});
      return { url: o.url, quote: o.quote, topic: o.topic, source };
    });
    const { facts, dropped } = verifyFacts(next.pages, claims, next.seq);
    next.seq += facts.length;
    return { items: facts, dropped };
  }
  /** @type {Item[]} */
  const items = [];
  /** @type {Dropped[]} */
  const dropped = [];
  for (const raw of raws) {
    const r = checkItem(next, n, /** @type {Loose} */ (raw ?? {}), `i${next.seq}`);
    if ("reason" in r) {
      dropped.push({ item: raw, reason: r.reason, detail: r.detail });
      continue;
    }
    next.seq += 1;
    items.push(r.item);
  }
  return { items, dropped };
}

/**
 * Einziger Weg, auf dem eine Modellantwort in den Zustand kommt.
 * @param {State} state
 * @param {StepNo} n
 * @param {unknown} raw Antwort von /api/step, erwartet { items: [...] }
 * @returns {State}
 */
export function applyResult(state, n, raw) {
  if (!canRun(state, n)) throw new Error(`Step ${n} cannot run now.`);
  const next = clone(state);
  const raws = /** @type {Loose} */ (raw ?? {}).items;
  const { items, dropped } = checkAll(next, n, Array.isArray(raws) ? raws : [], "model");
  next.steps[n] = { status: "draft", items, dropped };
  staleFrom(next, /** @type {StepNo} */ (n + 1));
  return next;
}

/**
 * Hinzufügen durch den Nutzer. Läuft durch dieselben Prüfungen wie die
 * Modellantwort. Fällt der Eintrag durch, steht er mit Grund in dropped.
 * @param {State} state
 * @param {StepNo} n
 * @param {Loose} raw
 * @param {ClaimSource} [source]
 * @returns {State}
 */
export function addItem(state, n, raw, source = "user") {
  const next = clone(state);
  const { items, dropped } = checkAll(next, n, [raw], source);
  const step = next.steps[n];
  step.dropped.push(...dropped);
  if (!items.length) return next;
  step.items.push(...items);
  if (step.status === "empty") step.status = "draft";
  staleFrom(next, /** @type {StepNo} */ (n + 1));
  return next;
}

/**
 * @param {State} state
 * @param {StepNo} n
 * @param {string} id
 * @param {Loose} patch
 * @returns {State}
 */
export function editItem(state, n, id, patch) {
  const at = state.steps[n].items.findIndex((i) => i.id === id);
  if (at < 0) return state;
  const old = /** @type {Loose} */ (/** @type {unknown} */ (state.steps[n].items[at]));
  const next = clone(state);
  const step = next.steps[n];
  /** @type {Item | undefined} */
  let item;
  if (n === 1) {
    const r = checkAll(next, 1, [{ ...old, ...patch }], "user");
    step.dropped.push(...r.dropped);
    item = r.items[0];
  } else {
    // Streichen geht nur über strikeSegment(), Zurückholen gar nicht.
    const merged = { ...old, ...patch };
    const r = checkItem(next, n, merged, id);
    if ("reason" in r) step.dropped.push({ item: merged, reason: r.reason, detail: r.detail });
    else item = n === 2 ? { ...r.item, ...(old.struck ? { struck: true, strikeReason: /** @type {string} */ (old.strikeReason) } : {}) } : r.item;
  }
  if (!item) return next;
  step.items[at] = item;
  staleFrom(next, /** @type {StepNo} */ (n + 1));
  return next;
}

/**
 * @param {State} state
 * @param {StepNo} n
 * @param {string} id
 * @returns {State}
 */
export function deleteItem(state, n, id) {
  // Segmente verschwinden nur über strikeSegment(), mit Begründung.
  if (n === 2 || !state.steps[n].items.some((i) => i.id === id)) return state;
  const next = clone(state);
  next.steps[n].items = next.steps[n].items.filter((i) => i.id !== id);
  dropApprovalIfEmpty(next, n);
  staleFrom(next, /** @type {StepNo} */ (n + 1));
  return next;
}

/**
 * Ein Segment streichen. Ohne Begründung geht es nicht.
 * @param {State} state
 * @param {string} id
 * @param {string} reason
 * @returns {{ state: State } | { error: string }}
 */
export function strikeSegment(state, id, reason) {
  const why = typeof reason === "string" ? reason.trim() : "";
  if (!why) return { error: "A reason is required to strike a segment." };
  const seg = segmentsOf(state).find((s) => s.id === id);
  if (!seg) return { error: "No such segment." };
  if (seg.struck) return { error: "Segment is already struck." };
  const next = clone(state);
  const target = /** @type {Segment} */ (segmentsOf(next).find((s) => s.id === id));
  target.struck = true;
  target.strikeReason = why.slice(0, MAX_TEXT);
  dropApprovalIfEmpty(next, 2);
  staleFrom(next, 3);
  return { state: next };
}

/**
 * Einziger Weg vom Zustand in den Body von /api/step. Nur freigegebene
 * Vorgänger, gestrichene Segmente und alles, was an ihnen hängt, fallen weg.
 * @param {State} state
 * @param {StepNo} n
 * @returns {Context}
 */
export function buildContext(state, n) {
  /** @type {Context} */
  const ctx = { step: n, domain: state.domain };
  /** @param {StepNo} k */
  const ok = (k) => k < n && state.steps[k].status === "approved";
  if (n === 1) {
    let left = MAX_PAGE_TEXT_TOTAL;
    let leftBytes = MAX_PAGE_TEXT_BYTES;
    ctx.pages = [];
    for (const p of state.pages) {
      if (left <= 0 || leftBytes <= 0) break;
      const text = cutToBytes(p.text.slice(0, left), leftBytes);
      if (!text) break;
      ctx.pages.push({ url: p.url, text });
      left -= text.length;
      leftBytes -= jsonBytes(text);
    }
  }
  if (ok(1)) ctx.facts = factsOf(state).map((f) => ({ url: f.url, quote: f.quote, topic: f.topic }));
  const live = segmentsOf(state).filter((s) => !s.struck);
  const liveIds = new Set(live.map((s) => s.id));
  if (ok(2)) ctx.segments = live.map((s) => ({ id: s.id, name: s.name, industry: s.industry, subIndustry: s.subIndustry, why: s.why }));
  /** @template {{ segmentId: string }} T @param {StepNo} k @returns {T[]} */
  const ofLive = (k) => /** @type {T[]} */ (/** @type {unknown[]} */ (state.steps[k].items)).filter((i) => liveIds.has(i.segmentId));
  if (ok(3)) ctx.personas = structuredClone(ofLive(/** @type {StepNo} */ (3)));
  if (ok(4)) ctx.signals = structuredClone(ofLive(/** @type {StepNo} */ (4)));
  if (ok(5)) ctx.keywords = structuredClone(ofLive(/** @type {StepNo} */ (5)));
  return ctx;
}
