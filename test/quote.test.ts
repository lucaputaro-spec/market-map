import { describe, expect, it } from "vitest";
import { findOnPage, verifyFacts } from "../public/lib/quote.js";
import type { Claim } from "../public/lib/types.js";
import { PAGES } from "./helpers";

const claim = (quote: unknown, url: unknown = "https://acme.test/", topic: unknown = "offering"): Claim => ({ url, quote, topic, source: "test" });

describe("findOnPage", () => {
  it("matches across typographic quotes, case and whitespace", () => {
    expect(findOnPage("“Hello  World”", PAGES[0]!.text)).toBe('"hello world"');
  });

  it("needs a word boundary on both sides", () => {
    expect(findOnPage("coute routes for regional", PAGES[0]!.text)).toBeNull();
    expect(findOnPage("plans delivery routes for regional", "Acme replans delivery routes for regional")).toBeNull();
  });
});

describe("verifyFacts", () => {
  it("keeps a quote that is on the named page, as written on the page", () => {
    const { facts, dropped } = verifyFacts(PAGES, [claim("PLANS delivery routes for regional bakeries")]);
    expect(dropped).toEqual([]);
    expect(facts).toEqual([{ id: "f1", url: "https://acme.test/", quote: "plans delivery routes for regional bakeries", topic: "offering", source: "test" }]);
  });

  it("drops an invented quote", () => {
    const { facts, dropped } = verifyFacts(PAGES, [claim("Acme serves 500 enterprise customers worldwide")]);
    expect(facts).toEqual([]);
    expect(dropped.map((d) => d.reason)).toEqual(["not_on_page"]);
  });

  it("drops a quote from page A sent with the URL of page B", () => {
    const { facts, dropped } = verifyFacts(PAGES, [claim("Plans start at €49 per month", "https://acme.test/", "pricing")]);
    expect(facts).toEqual([]);
    expect(dropped[0]?.reason).toBe("not_on_page");
  });

  it("names every drop reason and counts them", () => {
    const { facts, dropped } = verifyFacts(PAGES, [
      claim(""),
      claim("too short"),
      claim("x".repeat(301)),
      claim("Plans start at €49 per month", "https://other.test/pricing", "pricing"),
      claim("Plans start at €49 per month", "https://acme.test/pricing", "revenue"),
      claim("Plans start at €49 per month", "https://acme.test/pricing", "pricing"),
      claim("this sentence is nowhere at all"),
    ]);
    expect(facts).toHaveLength(1);
    expect(dropped.map((d) => d.reason)).toEqual(["no_quote", "quote_length", "quote_length", "unknown_url", "unknown_topic", "not_on_page"]);
    expect(dropped.length).toBe(6);
  });

  it("numbers facts from the given start", () => {
    const { facts } = verifyFacts(PAGES, [claim("Plans start at €49 per month", "https://acme.test/pricing", "pricing")], 7);
    expect(facts[0]?.id).toBe("f7");
  });
});
