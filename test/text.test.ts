import { describe, expect, it } from "vitest";
import { visibleText } from "../src/text";

describe("visibleText numeric entities", () => {
  it("leaves out-of-range and overlong entities as they are, without throwing", () => {
    expect(visibleText("a &#1114112; b")).toBe("a &#1114112; b");
    const long = `a &#${"9".repeat(25)}; b`;
    expect(visibleText(long)).toBe(long);
  });

  it("still decodes valid entities", () => {
    expect(visibleText("&#65;")).toBe("A");
  });
});
