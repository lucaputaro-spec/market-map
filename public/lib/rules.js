// Prüfregeln für die Schritte 4–6. Alles hier ist exakt und ohne Ermessen:
// was nicht passt, wird mit Grund verworfen, nicht still repariert.
// Ausnahme guardProof(): unbelegte Zahlen werden durch {proof} ersetzt, damit
// die Mail stehen bleibt, der Nutzer die Lücke aber sieht.

import { normalize } from "./quote.js";

/**
 * @typedef {import("./types.js").SignalType} SignalType
 * @typedef {import("./types.js").OfferCategory} OfferCategory
 * @typedef {import("./types.js").Email} Email
 * @typedef {import("./types.js").Fact} Fact
 * @typedef {import("./types.js").DropReason} DropReason
 */

/** @type {readonly SignalType[]} */
export const SIGNAL_TYPES = Object.freeze(["hiring", "funding", "new_sales_leader", "tech_stack"]);
/** @type {readonly OfferCategory[]} */
export const OFFER_CATEGORIES = Object.freeze(["make_money", "save_money", "save_time", "reduce_risk"]);

export const MAX_KEYWORDS = 15;
export const MIN_KEYWORD = 2;
export const MAX_KEYWORD = 40;
export const MAX_BODY_WORDS = 64;
export const MAX_SUBJECT_WORDS = 10;
export const PROOF = "{proof}";

/** @param {unknown} t @returns {t is SignalType} */
export const isSignalType = (t) => typeof t === "string" && /** @type {readonly string[]} */ (SIGNAL_TYPES).includes(t);

/** @param {unknown} c @returns {c is OfferCategory} */
export const isOfferCategory = (c) => typeof c === "string" && /** @type {readonly string[]} */ (OFFER_CATEGORIES).includes(c);

/**
 * @param {unknown[]} list
 * @returns {string[]}
 */
export function cleanKeywords(list) {
  /** @type {string[]} */
  const out = [];
  for (const k of list) {
    if (typeof k !== "string") continue;
    const word = k.replace(/\s+/g, " ").trim().toLowerCase();
    if (word.length < MIN_KEYWORD || word.length > MAX_KEYWORD || out.includes(word)) continue;
    out.push(word);
    if (out.length >= MAX_KEYWORDS) break;
  }
  return out;
}

const HAS_WORD_CHAR = /[\p{L}\p{N}]/u;

/** @param {string} text */
export function wordCount(text) {
  return text.split(/\s+/u).filter((t) => t.includes(PROOF) || HAS_WORD_CHAR.test(t)).length;
}

// Zahl mit Währung davor, oder Zahl mit %, Währung, x, percent/Prozent dahinter.
const NUMBER_CLAIM = /[€$]\s?\d+(?:[.,]\d+)*|\d+(?:[.,]\d+)*\s?(?:%|€|\$|x(?![\p{L}\p{N}])|percent(?![\p{L}])|prozent(?![\p{L}]))/giu;
const CUSTOMER_REF = /\b(customers like|clients such as|trusted by|used by|worked with)\b/i;

/**
 * Steht die Angabe wörtlich (ohne Leerraum verglichen) in einem Fact-Zitat,
 * und nicht nur als Teil einer längeren Zahl?
 * @param {string} claim
 * @param {Fact[]} facts
 */
function inFacts(claim, facts) {
  const needle = normalize(claim).replace(/\s/g, "");
  return facts.some((f) => {
    const hay = normalize(f.quote).replace(/\s/g, "");
    for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + 1)) {
      const before = hay[at - 1] ?? "";
      const after = hay[at + needle.length] ?? "";
      if (!/[\d.,]/.test(before) && !/\d/.test(after)) return true;
    }
    return false;
  });
}

/** @param {string} text @param {Fact[]} facts */
const replaceNumbers = (text, facts) => text.replace(NUMBER_CLAIM, (m) => (inFacts(m, facts) ? m : PROOF));

/**
 * @param {Email} email
 * @param {Fact[]} facts nur die geprüften Facts aus Schritt 1
 * @returns {{ email: Email } | { reason: DropReason, detail: string }}
 */
export function guardProof(email, facts) {
  const ref = `${email.subject}\n${email.body}`.match(CUSTOMER_REF);
  if (ref) return { reason: "unproven_customer", detail: `“${ref[0]}” names customers that no checked source proves` };
  const out = { subject: replaceNumbers(email.subject, facts), body: replaceNumbers(email.body, facts) };
  const words = wordCount(out.body);
  if (words > MAX_BODY_WORDS) return { reason: "too_long", detail: `email body has ${words} words, allowed ${MAX_BODY_WORDS}` };
  const subjectWords = wordCount(out.subject);
  if (subjectWords > MAX_SUBJECT_WORDS) return { reason: "subject_too_long", detail: `subject has ${subjectWords} words, allowed ${MAX_SUBJECT_WORDS}` };
  return { email: out };
}

/**
 * @param {{ category: unknown, email: Email }} offer
 * @param {Fact[]} facts
 * @returns {{ category: OfferCategory, email: Email } | { reason: DropReason, detail: string }}
 */
export function checkOffer(offer, facts) {
  if (!isOfferCategory(offer.category)) {
    return { reason: "unknown_category", detail: `category ${JSON.stringify(offer.category)} is not one of ${OFFER_CATEGORIES.join(", ")}` };
  }
  const r = guardProof(offer.email, facts);
  return "email" in r ? { category: offer.category, email: r.email } : r;
}
