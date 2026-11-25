// Prüft Eingaben, bevor der Worker fremde Seiten abruft. Ohne diese Prüfung
// könnte jemand den Worker als Werkzeug benutzen, um interne Adressen
// abzufragen oder riesige Dateien zu laden. Muster aus GTM OS (src/guard.ts).
// Bewusst ohne DNS-Prüfung: eine Domain, die auf 127.0.0.1 zeigt, käme durch.

import { pageText } from "./text";

export const MAX_BYTES = 300_000;
export const MAX_REDIRECTS = 3;
export const PAGE_TIMEOUT_MS = 7000;
export const SUBPAGES = ["/pricing", "/about", "/products"] as const;
export const MAX_PAGES = 1 + SUBPAGES.length;

// Diese Dienste lösen beliebige Namen auf beliebige IPs auf, z. B.
// 127.0.0.1.nip.io auf 127.0.0.1. Die Namensprüfung allein hält das nicht auf.
const WILDCARD_DNS = ["nip.io", "sslip.io", "localtest.me", "lvh.me"];

export interface Page {
  url: string;
  text: string;
}

export type SiteResult = { ok: true; domain: string; pages: Page[] } | { ok: false; reason: "invalid_domain" | "unreachable"; error: string };

export function normalizeDomain(input: string): string | null {
  let s = input.trim().toLowerCase();
  if (s.includes("@")) s = s.slice(s.lastIndexOf("@") + 1);
  s = s.replace(/^[a-z]+:\/\//, "").replace(/^www\./, "");
  s = s.split(/[/?#]/)[0] ?? "";
  if (s.length > 100 || s.includes(":")) return null;
  if (!/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/.test(s)) return null;
  if (/\.(local|internal|localhost|test|invalid|example)$/.test(s)) return null;
  if (s.endsWith("workers.dev")) return null;
  if (WILDCARD_DNS.some((d) => s === d || s.endsWith(`.${d}`))) return null;
  return s;
}

// Weiterleitungen selbst verfolgen: sonst könnte eine geprüfte Seite auf eine
// Adresse umleiten, die normalizeDomain abgelehnt hätte (z. B. *.workers.dev).
export function safeRedirect(location: string | null, current: string): string | null {
  if (!location) return null;
  try {
    const next = new URL(location, current);
    if (next.protocol !== "https:" || next.port !== "") return null;
    return normalizeDomain(next.hostname) ? next.href : null;
  } catch {
    return null;
  }
}

function fetchOnce(url: string, signal: AbortSignal): Promise<Response> {
  return fetch(url, {
    redirect: "manual",
    signal,
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; market-map-research/1.0)",
      accept: "text/html",
      "accept-language": "en,de;q=0.8",
    },
  });
}

async function readCapped(body: ReadableStream<Uint8Array>): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let html = "";
  let bytes = 0;
  while (bytes < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = value.byteLength > MAX_BYTES - bytes ? value.subarray(0, MAX_BYTES - bytes) : value;
    bytes += chunk.byteLength;
    html += decoder.decode(chunk, { stream: true });
  }
  await reader.cancel().catch(() => undefined);
  return html + decoder.decode();
}

// Eine Seite mit eigenem Timeout. url ist die Adresse nach allen Weiterleitungen.
// Mit onlyHost wird eine Weiterleitung auf einen anderen Host gar nicht erst abgerufen.
export async function fetchPage(start: string, onlyHost?: string): Promise<{ url: string; html: string } | null> {
  try {
    const signal = AbortSignal.timeout(PAGE_TIMEOUT_MS);
    let url = start;
    let res = await fetchOnce(url, signal);
    for (let hop = 0; res.status >= 300 && res.status < 400; hop++) {
      const next = hop < MAX_REDIRECTS ? safeRedirect(res.headers.get("location"), url) : null;
      if (!next || (onlyHost !== undefined && new URL(next).hostname !== onlyHost)) return null;
      url = next;
      res = await fetchOnce(url, signal);
    }
    if (!res.ok || !res.body) return null;
    if (!(res.headers.get("content-type") ?? "").includes("html")) return null;
    return { url, html: await readCapped(res.body) };
  } catch {
    return null;
  }
}

// Startseite zuerst: ihr Host nach den Weiterleitungen ist der Site-Host.
// Unterseiten, die woandershin umleiten, gehören nicht zur Firma und fallen weg.
export async function fetchSite(input: string): Promise<SiteResult> {
  const domain = normalizeDomain(input);
  if (!domain) return { ok: false, reason: "invalid_domain", error: "Not a public domain." };
  const home = await fetchPage(`https://${domain}/`);
  if (!home) return { ok: false, reason: "unreachable", error: "The homepage could not be loaded as HTML." };
  const siteHost = new URL(home.url).hostname;

  const subs = await Promise.all(SUBPAGES.map((path) => fetchPage(`https://${siteHost}${path}`, siteHost)));
  const pages: Page[] = [{ url: home.url, text: pageText(home.html) }];
  for (const sub of subs) {
    if (!sub) continue;
    if (pages.some((p) => p.url === sub.url)) continue;
    pages.push({ url: sub.url, text: pageText(sub.html) });
  }
  return { ok: true, domain, pages: pages.slice(0, MAX_PAGES) };
}
