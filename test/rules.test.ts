import { describe, expect, it } from "vitest";
import { checkOffer, cleanKeywords, guardProof, MAX_KEYWORDS, wordCount } from "../public/lib/rules.js";
import type { Fact } from "../public/lib/types.js";

// Testdaten: erfundenes Fact, nur für diese Tests.
const FACTS: Fact[] = [{ id: "f1", url: "https://acme.test/pricing", quote: "Plans start at €49 per month", topic: "pricing", source: "test" }];
const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");
const email = (body: string, subject = "Quick question") => ({ subject, body });

describe("wordCount", () => {
  it("counts tokens with a letter or digit, {proof} as one", () => {
    expect(wordCount("Hi Anna, – we cut costs by {proof} . ok")).toBe(8);
  });
});

describe("guardProof", () => {
  it("allows 64 body words and drops 65", () => {
    expect("email" in guardProof(email(words(64)), FACTS)).toBe(true);
    expect(guardProof(email(words(65)), FACTS)).toMatchObject({ reason: "too_long" });
  });

  it("limits the subject to 10 words", () => {
    expect("email" in guardProof(email("hi", words(10)), FACTS)).toBe(true);
    expect(guardProof(email("hi", words(11)), FACTS)).toMatchObject({ reason: "subject_too_long" });
  });

  it("replaces unproven numbers with {proof}", () => {
    expect(guardProof(email("We cut costs by 30%"), FACTS)).toEqual({ email: email("We cut costs by {proof}") });
    for (const claim of ["3x faster", "$20k saved", "40 percent less", "20 Prozent weniger", "save 15 € a day"]) {
      const r = guardProof(email(claim), FACTS);
      expect("email" in r && r.email.body, claim).toContain("{proof}");
    }
  });

  it("keeps a number that stands in a checked fact quote", () => {
    expect(guardProof(email("Plans from €49 a month."), FACTS)).toEqual({ email: email("Plans from €49 a month.") });
    expect(guardProof(email("Only €4 a month"), FACTS)).toEqual({ email: email("Only {proof} a month") });
  });

  it("drops customer references", () => {
    for (const body of ["Trusted by Siemens and others.", "Teams like yours, customers like Bosch", "clients such as Aldi", "used by 300 shops", "We worked with Lidl"]) {
      expect(guardProof(email(body), FACTS), body).toMatchObject({ reason: "unproven_customer" });
    }
  });

  it("counts words again after the replacement", () => {
    expect("email" in guardProof(email(`${words(63)} 30 %`), FACTS)).toBe(true);
  });
});

describe("checkOffer", () => {
  it("accepts only the exact category ids", () => {
    expect(checkOffer({ category: "save_time", idea: "Plan tours", email: email("hi") }, FACTS)).toMatchObject({ category: "save_time" });
    for (const category of ["Save Time", "save time", "SAVE_TIME", "", undefined]) {
      expect(checkOffer({ category, idea: "Plan tours", email: email("hi") }, FACTS)).toMatchObject({ reason: "unknown_category" });
    }
  });
});

describe("checkOffer idea", () => {
  it("replaces unproven numbers in the idea", () => {
    expect(checkOffer({ category: "save_money", idea: "Cut churn by 40%", email: email("hi") }, FACTS)).toMatchObject({ idea: "Cut churn by {proof}" });
  });

  it("drops customer references in the idea", () => {
    for (const idea of ["trusted by Siemens", "Cut churn by 40% like we did for Siemens"]) {
      expect(checkOffer({ category: "save_money", idea, email: email("hi") }, FACTS), idea).toMatchObject({ reason: "unproven_customer" });
    }
  });
});

describe("customer reference phrases", () => {
  it("catches like we did for, we helped, for clients like", () => {
    for (const body of ["Like we did for Bosch.", "We helped Aldi cut tours.", "Built for clients like Lidl."]) {
      expect(guardProof(email(body), FACTS), body).toMatchObject({ reason: "unproven_customer" });
    }
  });
});

describe("cleanKeywords", () => {
  it("lowercases, dedupes, keeps 2–40 characters and at most 10", () => {
    expect(cleanKeywords(["Route Planning", "route  planning", "x", "a".repeat(41), 7, "Bakery"])).toEqual(["route planning", "bakery"]);
    expect(MAX_KEYWORDS).toBe(10);
    expect(cleanKeywords(Array.from({ length: 20 }, (_, i) => `kw${i}`))).toHaveLength(10);
  });
});
