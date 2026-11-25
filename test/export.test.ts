import { describe, expect, it } from "vitest";
import { applyResult, approve, createState, editItem, strikeSegment } from "../public/lib/chain.js";
import { HEADER, toMarkdown } from "../public/lib/export.js";
import type { State, StepNo } from "../public/lib/types.js";
import { PAGES } from "./helpers";

// Testdaten: erfundene Firma und Segmente, nur für diese Tests.
const opts = { domain: "acme.test", date: "2026-11-25" };
const NAMES = ["Alpha Bakeries", "Beta Florists", "Gamma Butchers", "Delta Grocers", "Epsilon Caterers"];

function full(strike: string | null): State {
  let s = createState("acme.test", PAGES);
  s = approve(applyResult(s, 1, { items: [{ url: "https://acme.test/pricing", quote: "Plans start at €49 per month", topic: "pricing" }] }), 1);
  s = approve(applyResult(s, 2, { items: NAMES.map((name) => ({ name, industry: "Food", subIndustry: "Local", why: "Daily tours" })) }), 2);
  const ids = s.steps[2].items.map((i) => i.id);
  if (strike) {
    const r = strikeSegment(s, ids[NAMES.indexOf(strike)]!, "Too small");
    if ("error" in r) throw new Error(r.error);
    s = r.state;
  }
  const per = (make: (id: string, k: number) => unknown, count: number) => ids.flatMap((id) => Array.from({ length: count }, (_, k) => make(id, k)));
  const live = (id: string) => !s.steps[2].items.some((i) => i.id === id && "struck" in i && i.struck);
  const raws: Record<number, unknown[]> = {
    3: per((id, k) => ({ segmentId: id, title: `Persona ${k} of ${id}`, measuredOn: ["kpi"], problems: ["pain"] }), 4),
    4: per((id) => ({ segmentId: id, kind: "signal", type: "hiring", description: `Hiring at ${id}` }), 1),
    5: per((id) => ({ segmentId: id, keywords: ["bakery"] }), 1),
    6: per((id, k) => ({ segmentId: id, category: "save_time", idea: `Offer ${k}: cut churn by 40%`, email: { subject: "Tours", body: "Plans from €49.\nCut costs by 30%." } }), 4),
  };
  for (const n of [3, 4, 5, 6] as StepNo[]) {
    s = approve(applyResult(s, n, { items: (raws[n] ?? []).filter((r) => live((r as { segmentId: string }).segmentId)) }), n);
  }
  return s;
}

describe("toMarkdown", () => {
  it("starts with the AI draft line and lists the sources", () => {
    const md = toMarkdown(full(null), opts);
    expect(md.split("\n")[0]).toBe(HEADER);
    expect(md).toContain('- "Plans start at €49 per month" (pricing, https://acme.test/pricing)');
  });

  it("has at most 3 segments, 3 personas and 3 offers each, and keeps {proof}", () => {
    const md = toMarkdown(full(null), opts);
    expect(md.match(/^### /gm)).toHaveLength(3);
    expect(md).not.toContain("Delta Grocers");
    expect(md.match(/^- \*\*Persona/gm)).toHaveLength(9);
    expect(md.match(/^- \*\*save_time\*\*/gm)).toHaveLength(9);
    expect(md).toContain("> Cut costs by {proof}.");
    expect(md).toContain("cut churn by {proof}");
    expect(md).not.toContain("40%");
  });

  it("leaves out a struck segment and its personas", () => {
    const s = full("Beta Florists");
    const struckId = s.steps[2].items[1]!.id;
    const md = toMarkdown(s, opts);
    expect(md).not.toContain("Beta Florists");
    expect(md).not.toContain(`of ${struckId}`);
    expect(md).toContain("Delta Grocers");
  });

  it("refuses while a step is stale or not approved", () => {
    const s = full(null);
    expect(() => toMarkdown(editItem(s, 2, s.steps[2].items[0]!.id, { why: "Changed" }), opts)).toThrow(/outdated/);
    expect(() => toMarkdown(createState("acme.test", PAGES), opts)).toThrow();
    const draft = structuredClone(s);
    draft.steps[6].status = "draft";
    expect(() => toMarkdown(draft, opts)).toThrow(/step 6/);
  });
});
