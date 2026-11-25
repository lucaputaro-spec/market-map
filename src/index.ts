// Einstiegspunkt. Der Worker liefert die Seite aus und hat drei Schnittstellen:
// GET /api/status, POST /api/fetch (Website-Abruf) und POST /api/step (AI-Schritt).
// Gespeichert und geloggt wird nichts. Prüfmuster aus Objection Cards.

import { fetchSite } from "./guard";

export interface Env {
  ASSETS: Fetcher;
  LIMITER?: RateLimit;
  AI?: Ai;
  AI_MODEL?: string;
  // Nur der Text "true" schaltet frei. Fehlt die Variable oder steht etwas
  // anderes drin, bleibt alles aus, was fremde Seiten oder Workers AI berührt.
  AI_ENABLED?: string;
}

export const aiEnabled = (env: Pick<Env, "AI_ENABLED">): boolean => env.AI_ENABLED === "true";

const MAX_BODY_BYTES: Record<string, number> = { "/api/fetch": 2000, "/api/step": 40_000 };

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function sameHost(origin: string, host: string): boolean {
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    if (url.pathname === "/api/status") return json({ ai: aiEnabled(env) });
    const maxBytes = MAX_BODY_BYTES[url.pathname];
    if (maxBytes === undefined) return json({ error: "Unknown endpoint." }, 404);
    if (request.method !== "POST") return json({ error: "Use POST." }, 405);
    if (!aiEnabled(env)) return json({ error: "AI is off. Start with npm run dev:ai." }, 403);

    // Kein Origin-Header (z. B. curl) ist erlaubt. "null" oder ein ungültiger Wert ergibt 403, nicht 500.
    const origin = request.headers.get("origin");
    if (origin !== null && !sameHost(origin, url.host)) return json({ error: "Cross-site requests are not allowed." }, 403);

    if (env.LIMITER) {
      const key = request.headers.get("cf-connecting-ip") ?? "unknown";
      const { success } = await env.LIMITER.limit({ key });
      if (!success) return json({ error: "Too many requests. Wait a minute." }, 429);
    }

    let body: Record<string, unknown>;
    try {
      const raw = await request.text();
      if (new TextEncoder().encode(raw).length > maxBytes) return json({ error: "Request is too large." }, 413);
      body = (JSON.parse(raw) ?? {}) as Record<string, unknown>;
    } catch {
      return json({ error: "Body must be JSON." }, 400);
    }

    if (url.pathname === "/api/fetch") {
      if (typeof body.domain !== "string") return json({ error: "Send {domain}." }, 400);
      const site = await fetchSite(body.domain);
      if (!site.ok) return json({ error: site.error }, site.reason === "invalid_domain" ? 400 : 502);
      return json({ domain: site.domain, pages: site.pages });
    }
    // /api/step: runStep() aus src/steps.ts kommt mit Plan-Schritt 6.
    return json({ error: "Not built yet." }, 501);
  },
} satisfies ExportedHandler<Env>;
