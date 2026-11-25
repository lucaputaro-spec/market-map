// Markdown-Export. Nur möglich, wenn alle 6 Schritte freigegeben sind und
// keiner veraltet ist. Gestrichene Segmente und alles, was an ihnen hängt,
// kommen nicht hinein. {proof} bleibt sichtbar, damit niemand die Lücke übersieht.

import { STEPS } from "./types.js";

/**
 * @typedef {import("./types.js").State} State
 * @typedef {import("./types.js").Fact} Fact
 * @typedef {import("./types.js").Segment} Segment
 * @typedef {import("./types.js").Persona} Persona
 * @typedef {import("./types.js").Source} Source
 * @typedef {import("./types.js").Signal} Signal
 * @typedef {import("./types.js").Keyword} Keyword
 * @typedef {import("./types.js").Offer} Offer
 */

export const HEADER = "AI draft (Workers AI), edited by a person. Not verified research.";
export const TOP_SEGMENTS = 3;
export const PERSONAS_PER_SEGMENT = 3;
export const OFFERS_PER_SEGMENT = 3;

/**
 * Warum der Export noch nicht geht, oder null.
 * @param {State} state
 * @returns {string | null}
 */
export function exportBlocker(state) {
  const open = STEPS.filter((n) => state.steps[n].status !== "approved");
  return open.length ? `Approve all steps first. Not approved or outdated: step ${open.join(", ")}.` : null;
}

/** @param {string} s */
const line = (s) => s.replace(/\s+/g, " ").trim();

/**
 * @param {State} state
 * @param {{ domain: string, date: string }} opts
 * @returns {string}
 */
export function toMarkdown(state, { domain, date }) {
  const blocker = exportBlocker(state);
  if (blocker) throw new Error(blocker);
  const facts = /** @type {Fact[]} */ (state.steps[1].items);
  const segments = /** @type {Segment[]} */ (state.steps[2].items).filter((s) => !s.struck).slice(0, TOP_SEGMENTS);
  const personas = /** @type {Persona[]} */ (state.steps[3].items);
  const step4 = /** @type {(Source | Signal)[]} */ (state.steps[4].items);
  const keywords = /** @type {Keyword[]} */ (state.steps[5].items);
  const offers = /** @type {Offer[]} */ (state.steps[6].items);

  const out = [HEADER, "", `# Market Map: ${line(domain)}`, "", `Date: ${date}`, "", "## Sources", ""];
  out.push(...(facts.length ? facts.map((f) => `- "${line(f.quote)}" (${f.topic}, ${f.url})`) : ["- none"]), "");
  out.push(`## Top ${segments.length} segments`, "");

  segments.forEach((seg, i) => {
    out.push(`### ${i + 1}. ${line(seg.name)}`, "", `${line(seg.industry)} / ${line(seg.subIndustry)}`, "", `Why: ${line(seg.why)}`, "");
    const ps = personas.filter((p) => p.segmentId === seg.id).slice(0, PERSONAS_PER_SEGMENT);
    out.push("#### Personas", "");
    out.push(...(ps.length ? ps.map((p) => `- **${line(p.title)}**. Measured on: ${p.measuredOn.map(line).join(", ") || "–"}. Problems: ${p.problems.map(line).join("; ") || "–"}.`) : ["- none"]), "");
    const own = step4.filter((x) => x.segmentId === seg.id);
    out.push("#### Data sources and signals", "");
    const s4 = own.map((x) => (x.kind === "source" ? `- Source: ${line(x.name)}. ${line(x.why)}` : `- Signal (${x.type}): ${line(x.description)}`));
    out.push(...(s4.length ? s4 : ["- none"]), "");
    const kw = keywords.filter((k) => k.segmentId === seg.id).flatMap((k) => k.keywords);
    out.push("#### Keywords", "", kw.length ? kw.join(", ") : "none", "");
    const os = offers.filter((o) => o.segmentId === seg.id).slice(0, OFFERS_PER_SEGMENT);
    out.push("#### Offers", "");
    if (!os.length) out.push("- none", "");
    for (const o of os) {
      out.push(`- **${o.category}**: ${line(o.idea)}`, "", `  Subject: ${line(o.email.subject)}`, "");
      out.push(...o.email.body.split(/\r?\n/).map((l) => `  > ${l}`), "");
    }
  });
  return out.join("\n");
}
