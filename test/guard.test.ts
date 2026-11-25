import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchPage, fetchSite, MAX_BYTES, normalizeDomain } from "../src/guard";

// Testdaten: erfundene Seiten, nur für diese Tests.
const html = (body = "<html><body>ok</body></html>") => new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });
const redirect = (to: string) => new Response(null, { status: 302, headers: { location: to } });

afterEach(() => vi.unstubAllGlobals());

describe("normalizeDomain", () => {
  it("accepts a public domain and strips scheme, www and path", () => {
    expect(normalizeDomain("https://www.Acme.io/pricing?x=1")).toBe("acme.io");
  });

  it("rejects local, private, internal, workers.dev, wildcard DNS and ports", () => {
    for (const bad of ["localhost", "127.0.0.1", "10.0.0.1", "192.168.1.1", "[::1]", "foo.local", "x.internal", "a.workers.dev", "1.2.3.4.nip.io", "1.2.3.4.sslip.io", "app.localtest.me", "x.lvh.me", "example.com:8443"]) {
      expect(normalizeDomain(bad), bad).toBeNull();
    }
  });
});

describe("fetchPage redirects", () => {
  it("aborts a redirect to http or to a port", async () => {
    for (const target of ["http://acme.io/", "https://acme.io:8443/"]) {
      const calls: string[] = [];
      vi.stubGlobal("fetch", vi.fn(async (url: string) => {
        calls.push(url);
        return calls.length === 1 ? redirect(target) : html();
      }));
      expect(await fetchPage("https://acme.io/")).toBeNull();
      expect(calls).toHaveLength(1);
    }
  });

  it("follows 3 redirects and aborts at the 4th", async () => {
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async () => (++n <= 3 ? redirect(`https://acme.io/${n}`) : html())));
    expect((await fetchPage("https://acme.io/"))?.url).toBe("https://acme.io/3");

    n = 0;
    vi.stubGlobal("fetch", vi.fn(async () => (++n <= 4 ? redirect(`https://acme.io/${n}`) : html())));
    expect(await fetchPage("https://acme.io/")).toBeNull();
    expect(n).toBe(4);
  });

  it("drops non-HTML", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { headers: { "content-type": "application/json" } })));
    expect(await fetchPage("https://acme.io/")).toBeNull();
  });

  it("cuts the body after 300 000 bytes", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => html("a".repeat(MAX_BYTES + 50_000))));
    const page = await fetchPage("https://acme.io/");
    expect(page?.html.length).toBe(MAX_BYTES);
  });
});

describe("fetchSite", () => {
  it("uses the homepage host after redirects and drops subpages that leave it", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calls.push(url);
      if (url === "https://acme.io/") return redirect("https://www.acme.io/");
      if (url === "https://www.acme.io/about") return redirect("https://other.io/about");
      if (url === "https://www.acme.io/products") return new Response("%PDF", { headers: { "content-type": "application/pdf" } });
      return html(`<html><body>page ${url}</body></html>`);
    }));
    const site = await fetchSite("acme.io");
    expect(site.ok).toBe(true);
    if (!site.ok) return;
    expect(site.pages.map((p) => p.url)).toEqual(["https://www.acme.io/", "https://www.acme.io/pricing"]);
    expect(site.pages[1]?.text).toBe("page https://www.acme.io/pricing");
    expect(calls).toContain("https://www.acme.io/pricing");
    expect(calls).not.toContain("https://other.io/about");
  });

  it("rejects a bad domain without any request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const site = await fetchSite("1.2.3.4.nip.io");
    expect(site.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cuts the visible text to 6 000 characters per page", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => html(`<p>${"word ".repeat(3000)}</p>`)));
    const site = await fetchSite("acme.io");
    expect(site.ok && site.pages[0]?.text.length).toBe(6000);
  });
});
