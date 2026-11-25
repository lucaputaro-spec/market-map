import { describe, expect, it } from "vitest";
import { AI_UNAVAILABLE, aiResult, contextTooLarge, MAX_AI_CALLS_PER_SESSION, MAX_STEP_BODY_BYTES } from "../public/lib/ai.js";
import { MAX_BODY_BYTES } from "../src/index";
import { applyResult, createState } from "../public/lib/chain.js";
import type { State } from "../public/lib/types.js";
import { PAGES } from "./helpers";

// Derselbe Ablauf wie in app.js: nur bei "use" geht die Antwort in applyResult.
function afterCall(state: State, res: { status: number; body?: unknown } | null): { state: State; error: string | null } {
  const verdict = aiResult(res);
  return verdict === "use" ? { state: applyResult(state, 1, res?.body), error: null } : { state, error: verdict };
}

describe("aiResult", () => {
  it("uses only a 200 with an items list", () => {
    expect(aiResult({ status: 200, body: { items: [] } })).toBe("use");
    expect(aiResult({ status: 200, body: { error: "x" } })).toBe(AI_UNAVAILABLE);
  });

  it("429, 5xx and network errors are errors and the step stays empty", () => {
    const s = createState("acme.test", PAGES);
    for (const res of [{ status: 429 }, { status: 500 }, { status: 502, body: { error: "Model answer was not JSON. Nothing was generated." } }, { status: 503 }, null]) {
      const r = afterCall(s, res);
      expect(r.error, JSON.stringify(res)).toMatch(/Nothing was generated/);
      expect(r.state.steps[1].status).toBe("empty");
      expect(r.state.steps[1].items).toEqual([]);
    }
  });

  it("says the switch is off on 403", () => {
    expect(aiResult({ status: 403 })).toBe("AI is off. Start with npm run dev:ai.");
  });

  it("caps the session at 30 calls", () => {
    expect(MAX_AI_CALLS_PER_SESSION).toBe(30);
  });
});

describe("contextTooLarge", () => {
  it("names size and limit above 40 000 bytes and is null below", () => {
    const msg = contextTooLarge({ step: 3, facts: [{ quote: "ü".repeat(25_000) }] });
    expect(msg).toMatch(/40[ ,.]?000/);
    expect(msg).toMatch(/shorten or delete/i);
    expect(contextTooLarge({ step: 3, facts: [] })).toBeNull();
  });

  it("uses the same limit as the worker", () => {
    expect(MAX_STEP_BODY_BYTES).toBe(MAX_BODY_BYTES["/api/step"]);
  });

  it("413 says the request is too large and nothing was generated", () => {
    expect(aiResult({ status: 413 })).toBe("Request is too large (over 40 000 bytes). Nothing was generated.");
  });
});
