// Der Zitat-Riegel für Schritt 1. Jede Angabe, egal ob vom Modell, vom Nutzer
// oder aus dem Test, muss wörtlich im Text genau der Seite stehen, deren URL
// sie nennt. Nur verifyFacts() erzeugt Facts.
// Angeglichen werden nur Leerraum, Groß-/Kleinschreibung, typografische
// Anführungszeichen und NFC. Kein Fuzzy-Match: lieber eine verworfene Angabe
// zu viel als ein erfundenes Zitat.

/**
 * @typedef {import("./types.js").Page} Page
 * @typedef {import("./types.js").Claim} Claim
 * @typedef {import("./types.js").Fact} Fact
 * @typedef {import("./types.js").Topic} Topic
 * @typedef {import("./types.js").Dropped} Dropped
 * @typedef {import("./types.js").DropReason} DropReason
 * @typedef {{ norm: string, map: number[], ends: number[] }} Normalized
 */

export const MIN_QUOTE = 12;
export const MAX_QUOTE = 300;
/** @type {readonly Topic[]} */
export const TOPICS = Object.freeze(["offering", "customers", "pricing"]);

const SINGLE_QUOTES = /[‘’‚‛′´`]/g;
const DOUBLE_QUOTES = /[“”„‟″«»]/g;
const SPACE = /\s/u;
const MARK = /\p{M}/u;
const WORD_CHAR = /[\p{L}\p{N}]/u;

/**
 * Normalisiert und merkt sich zu jedem Zeichen Anfang und Ende im Original,
 * damit ein Fact das Zitat so zeigt, wie es auf der Seite steht.
 * Ein Abschnitt ist ein Zeichen samt folgender Kombinationszeichen, weil NFC
 * die Länge ändern darf.
 * @param {string} s
 * @returns {Normalized}
 */
function normalizeFull(s) {
  let norm = "";
  /** @type {number[]} */
  const map = [];
  /** @type {number[]} */
  const ends = [];
  let i = 0;
  let lastWasSpace = false;
  while (i < s.length) {
    const start = i;
    const cp = /** @type {number} */ (s.codePointAt(i));
    i += cp > 0xffff ? 2 : 1;
    while (i < s.length && MARK.test(s[i] ?? "")) i += 1;
    const segment = s.slice(start, i);
    if (SPACE.test(segment)) {
      if (lastWasSpace) {
        ends[ends.length - 1] = i;
        continue;
      }
      norm += " ";
      map.push(start);
      ends.push(i);
      lastWasSpace = true;
      continue;
    }
    lastWasSpace = false;
    const out = segment.normalize("NFC").replace(SINGLE_QUOTES, "'").replace(DOUBLE_QUOTES, '"').toLowerCase();
    for (let k = 0; k < out.length; k += 1) {
      map.push(start);
      ends.push(i);
    }
    norm += out;
  }
  return { norm, map, ends };
}

/** @param {string} s */
export const normalize = (s) => normalizeFull(s).norm.trim();

/**
 * Erste Fundstelle mit Wortgrenze an beiden Rändern, als Original-Ausschnitt.
 * @param {string} quote
 * @param {string} text
 * @returns {string | null}
 */
export function findOnPage(quote, text) {
  const needle = normalize(quote);
  if (!needle) return null;
  const { norm, map, ends } = normalizeFull(text);
  let from = 0;
  for (let at = norm.indexOf(needle, from); at >= 0; at = norm.indexOf(needle, from)) {
    const end = at + needle.length;
    const before = norm[at - 1] ?? "";
    const after = norm[end] ?? "";
    if (!WORD_CHAR.test(before) && !WORD_CHAR.test(after)) {
      return text.slice(/** @type {number} */ (map[at]), /** @type {number} */ (ends[end - 1]));
    }
    from = at + 1;
  }
  return null;
}

/** @param {unknown} t @returns {t is Topic} */
const isTopic = (t) => typeof t === "string" && /** @type {readonly string[]} */ (TOPICS).includes(t);

/**
 * Einziger Erzeuger von Facts. Was nicht wörtlich auf der genannten Seite
 * steht, landet mit Grund in dropped.
 * @param {Page[]} pages die abgerufenen Seiten
 * @param {Claim[]} claims
 * @param {number} [firstId] Nummer des ersten neuen Facts, damit IDs eindeutig bleiben
 * @returns {{ facts: Fact[], dropped: Dropped[] }}
 */
export function verifyFacts(pages, claims, firstId = 1) {
  const byUrl = new Map(pages.map((p) => [p.url, p]));
  /** @type {Fact[]} */
  const facts = [];
  /** @type {Dropped[]} */
  const dropped = [];
  const seen = new Set();
  /** @param {Claim} item @param {DropReason} reason @param {string} detail */
  const drop = (item, reason, detail) => dropped.push({ item, reason, detail });

  for (const claim of claims) {
    const quote = typeof claim.quote === "string" ? claim.quote.trim() : "";
    if (!quote) {
      drop(claim, "no_quote", "statement has no quote");
      continue;
    }
    const length = normalize(quote).length;
    if (length < MIN_QUOTE || length > MAX_QUOTE) {
      drop(claim, "quote_length", `quote has ${length} characters, allowed ${MIN_QUOTE}–${MAX_QUOTE}`);
      continue;
    }
    const page = typeof claim.url === "string" ? byUrl.get(claim.url) : undefined;
    if (!page) {
      drop(claim, "unknown_url", `${JSON.stringify(claim.url)} is not one of the fetched pages`);
      continue;
    }
    const original = findOnPage(quote, page.text);
    if (original === null) {
      drop(claim, "not_on_page", `quote does not appear word for word on ${page.url}`);
      continue;
    }
    if (!isTopic(claim.topic)) {
      drop(claim, "unknown_topic", `topic ${JSON.stringify(claim.topic)} is not one of ${TOPICS.join(", ")}`);
      continue;
    }
    const key = `${page.url}|${normalize(original)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    facts.push(Object.freeze({ id: `f${firstId + facts.length}`, url: page.url, quote: original, topic: claim.topic, source: claim.source }));
  }
  return { facts, dropped };
}
