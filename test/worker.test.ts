import { afterEach, describe, expect, it, vi } from "vitest";
import worker, { type Env } from "../src/index";

const assets = { fetch: async () => new Response("page") } as unknown as Fetcher;
const env = (extra: Partial<Env> = {}): Env => ({ ASSETS: assets, ...extra });
const call = (req: Request, e: Env) => worker.fetch(req as Parameters<typeof worker.fetch>[0], e);
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`https://map.test${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });

afterEach(() => vi.unstubAllGlobals());

describe("worker gate", () => {
  it("reports the switch on /api/status", async () => {
    expect(await (await call(new Request("https://map.test/api/status"), env())).json()).toEqual({ ai: false });
    expect(await (await call(new Request("https://map.test/api/status"), env({ AI_ENABLED: "true" }))).json()).toEqual({ ai: true });
  });

  it("answers 403 on both POST routes when AI_ENABLED is false or missing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    for (const e of [env(), env({ AI_ENABLED: "false" }), env({ AI_ENABLED: "TRUE" })]) {
      for (const path of ["/api/fetch", "/api/step"]) {
        expect((await call(post(path, { domain: "acme.io" }), e)).status, path).toBe(403);
      }
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers 403 on origin null or a foreign origin", async () => {
    const on = env({ AI_ENABLED: "true" });
    for (const origin of ["null", "https://evil.test", "not a url"]) {
      for (const path of ["/api/fetch", "/api/step"]) {
        expect((await call(post(path, { domain: "acme.io" }, { origin }), on)).status).toBe(403);
      }
    }
  });

  it("answers 429 when the limiter says no", async () => {
    const LIMITER = { limit: async () => ({ success: false }) } as unknown as RateLimit;
    const res = await call(post("/api/fetch", { domain: "acme.io" }, { origin: "https://map.test" }), env({ AI_ENABLED: "true", LIMITER }));
    expect(res.status).toBe(429);
  });

  it("answers 413 above 2 000 bytes on /api/fetch", async () => {
    const res = await call(post("/api/fetch", { domain: "a".repeat(2100) }), env({ AI_ENABLED: "true" }));
    expect(res.status).toBe(413);
  });

  it("rejects a private domain with 400 and fetches nothing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await call(post("/api/fetch", { domain: "127.0.0.1" }), env({ AI_ENABLED: "true" }));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the pages when the switch is on", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(`<p>hi ${url}</p>`, { headers: { "content-type": "text/html" } })));
    const res = await call(post("/api/fetch", { domain: "acme.io" }, { origin: "https://map.test" }), env({ AI_ENABLED: "true" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { domain: string; pages: { url: string }[] };
    expect(body.domain).toBe("acme.io");
    expect(body.pages).toHaveLength(4);
  });
});
