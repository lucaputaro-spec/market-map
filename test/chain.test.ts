import { describe, expect, it } from "vitest";
import { addItem, applyResult, approve, buildContext, canRun, createState, deleteItem, editItem, strikeSegment } from "../public/lib/chain.js";
import type { State, StepNo } from "../public/lib/types.js";
import { PAGES } from "./helpers";

// Testdaten: erfundene Modellantworten zu "Acme Routing", nur für Tests.
const FACT = { url: "https://acme.test/pricing", quote: "Plans start at €49 per month", topic: "pricing" };
const SEGMENTS = [
  { name: "Regional bakeries", industry: "Food", subIndustry: "Bakery chains", why: "Daily delivery tours" },
  { name: "Zebra Florists", industry: "Retail", subIndustry: "Florists", why: "Same-day delivery" },
];
const status = (s: State) => ([1, 2, 3, 4, 5, 6] as StepNo[]).map((n) => s.steps[n].status);

function throughStep2(): State {
  let s = createState("acme.test", PAGES);
  s = approve(applyResult(s, 1, { items: [FACT] }), 1);
  return approve(applyResult(s, 2, { items: SEGMENTS }), 2);
}
const segId = (s: State, name: string) => s.steps[2].items.find((i) => "name" in i && i.name === name)!.id;

function rawFor(n: StepNo, segmentId: string): unknown {
  if (n === 3) return { segmentId, title: "Head of Logistics", measuredOn: ["on-time rate"], problems: ["late tours"] };
  if (n === 4) return { segmentId, kind: "signal", type: "hiring", description: "Hiring drivers" };
  if (n === 5) return { segmentId, keywords: ["Bakery", "delivery"] };
  return { segmentId, category: "save_time", idea: "Plan tours", email: { subject: "Tours", body: "Plans from €49 a month." } };
}

describe("chain order", () => {
  it("step 3 cannot start before step 2 is approved", () => {
    let s = createState("acme.test", PAGES);
    s = approve(applyResult(s, 1, { items: [FACT] }), 1);
    s = applyResult(s, 2, { items: SEGMENTS });
    expect(canRun(s, 3)).toBe(false);
    expect(() => applyResult(s, 3, { items: [] })).toThrow();
    expect(canRun(approve(s, 2), 3)).toBe(true);
  });

  it("an edit to step 2 keeps it approved and makes 3–6 stale", () => {
    let s = throughStep2();
    const a = segId(s, "Regional bakeries");
    for (const n of [3, 4, 5, 6] as StepNo[]) s = approve(applyResult(s, n, { items: [rawFor(n, a)] }), n);
    expect(status(s)).toEqual(["approved", "approved", "approved", "approved", "approved", "approved"]);
    const edited = editItem(s, 2, a, { why: "Many daily tours" });
    expect(status(edited)).toEqual(["approved", "approved", "stale", "stale", "stale", "stale"]);
    expect(status(deleteItem(s, 2, segId(s, "Zebra Florists")))).toEqual(["approved", "approved", "stale", "stale", "stale", "stale"]);
  });

  it("an edit to step 1 makes the later steps stale", () => {
    const s = throughStep2();
    const id = s.steps[1].items[0]!.id;
    expect(status(editItem(s, 1, id, { topic: "offering" }))).toEqual(["approved", "stale", "empty", "empty", "empty", "empty"]);
  });

  it("a user fact without a quote on the page is dropped and counted", () => {
    const s = throughStep2();
    const next = addItem(s, 1, { url: "https://acme.test/", quote: "Acme is trusted by 500 bakeries", topic: "customers" }, "test");
    expect(next.steps[1].items).toHaveLength(1);
    expect(next.steps[1].dropped.at(-1)?.reason).toBe("not_on_page");
    expect(status(next)).toEqual(status(s));
  });
});

describe("strikeSegment", () => {
  it("fails without a reason and changes nothing", () => {
    const s = throughStep2();
    for (const reason of ["", "   "]) {
      const r = strikeSegment(s, segId(s, "Zebra Florists"), reason);
      expect(r).toEqual({ error: expect.any(String) });
    }
    expect(s.steps[2].items.some((i) => "struck" in i)).toBe(false);
  });

  it("marks the segment with its reason and makes 3–6 stale after step 2 was approved", () => {
    let s = throughStep2();
    const a = segId(s, "Regional bakeries");
    s = approve(applyResult(s, 3, { items: [rawFor(3, a)] }), 3);
    s = applyResult(s, 4, { items: [rawFor(4, a)] });
    const r = strikeSegment(s, segId(s, "Zebra Florists"), "No budget");
    if (!("state" in r)) throw new Error(r.error);
    expect(r.state.steps[2].items.find((i) => i.id === segId(s, "Zebra Florists"))).toMatchObject({ struck: true, strikeReason: "No budget" });
    expect(status(r.state)).toEqual(["approved", "approved", "stale", "stale", "empty", "empty"]);
  });

  it("the struck segment's name never reaches the context of steps 3–6", () => {
    let s = throughStep2();
    const a = segId(s, "Regional bakeries");
    const z = segId(s, "Zebra Florists");
    const r = strikeSegment(s, z, "Too small");
    if (!("state" in r)) throw new Error(r.error);
    s = r.state;
    for (const n of [3, 4, 5, 6] as StepNo[]) {
      const ctx = JSON.stringify(buildContext(s, n));
      expect(ctx, `step ${n}`).not.toContain("Zebra Florists");
      expect(ctx, `step ${n}`).not.toContain(z);
      if (n < 6) s = approve(applyResult(s, n, { items: [rawFor(n, a)] }), n);
    }
    expect(JSON.parse(JSON.stringify(buildContext(s, 6))).segments).toHaveLength(1);
  });
});

describe("applyResult", () => {
  it("drops a persona with a struck or unknown segmentId", () => {
    const s0 = throughStep2();
    const z = segId(s0, "Zebra Florists");
    const r = strikeSegment(s0, z, "Too small");
    if (!("state" in r)) throw new Error(r.error);
    const s = applyResult(r.state, 3, { items: [rawFor(3, z), rawFor(3, "nope"), rawFor(3, segId(s0, "Regional bakeries"))] });
    expect(s.steps[3].items).toHaveLength(1);
    expect(s.steps[3].dropped.map((d) => d.reason)).toEqual(["struck_segment", "unknown_segment"]);
  });

  it("runs verifyFacts on step 1 and the rules on steps 4–6", () => {
    let s = createState("acme.test", PAGES);
    s = applyResult(s, 1, { items: [FACT, { ...FACT, quote: "We serve 900 bakeries in Europe" }] });
    expect(s.steps[1].dropped.map((d) => d.reason)).toEqual(["not_on_page"]);
    s = approve(applyResult(approve(s, 1), 2, { items: SEGMENTS }), 2);
    const a = segId(s, "Regional bakeries");
    s = approve(applyResult(s, 3, { items: [rawFor(3, a)] }), 3);
    s = approve(applyResult(s, 4, { items: [rawFor(4, a), { segmentId: a, kind: "signal", type: "rumour", description: "x" }] }), 4);
    expect(s.steps[4].dropped.map((d) => d.reason)).toEqual(["unknown_signal_type"]);
    s = approve(applyResult(s, 5, { items: [rawFor(5, a)] }), 5);
    expect(s.steps[5].items[0]).toMatchObject({ keywords: ["bakery", "delivery"] });
    s = applyResult(s, 6, {
      items: [
        rawFor(6, a),
        { segmentId: a, category: "Save Time", idea: "x", email: { subject: "s", body: "b" } },
        { segmentId: a, category: "save_money", idea: "x", email: { subject: "s", body: "Cut costs by 30%" } },
        { segmentId: a, category: "save_money", idea: "x", email: { subject: "s", body: "Trusted by Siemens" } },
      ],
    });
    expect(s.steps[6].items.map((i) => "email" in i && i.email.body)).toEqual(["Plans from €49 a month.", "Cut costs by {proof}"]);
    expect(s.steps[6].dropped.map((d) => d.reason)).toEqual(["unknown_category", "unproven_customer"]);
  });

  it("does not change the state it was given", () => {
    const s = throughStep2();
    const before = JSON.stringify(s);
    applyResult(s, 3, { items: [rawFor(3, segId(s, "Regional bakeries"))] });
    strikeSegment(s, segId(s, "Zebra Florists"), "x");
    expect(JSON.stringify(s)).toBe(before);
  });
});
