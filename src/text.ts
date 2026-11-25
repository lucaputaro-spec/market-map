// Sichtbarer Text einer HTML-Seite. Übernommen aus GTM OS (src/signals.ts).
// Genau dieser Text geht an das Modell und an verifyFacts() im Browser, damit
// ein Zitat gegen dasselbe geprüft wird, was das Modell gesehen hat.

export const MAX_PAGE_CHARS = 6000;

function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    // Außerhalb des Unicode-Bereichs wirft fromCodePoint, und die ganze Seite fiele weg.
    .replace(/&#(\d+);/g, (m, n: string) => {
      const cp = Number(n);
      return Number.isSafeInteger(cp) && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    });
}

export function visibleText(html: string): string {
  return decode(
    html
      .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

export const pageText = (html: string): string => visibleText(html).slice(0, MAX_PAGE_CHARS);
