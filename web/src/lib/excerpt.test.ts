import { describe, expect, it } from "vitest";
import { ageLabel, excerptAround, findExcerpt } from "./excerpt";

describe("excerpt", () => {
  it("uses the selection when present", () => {
    expect(excerptAround("hello world", 6, 11)).toBe("world");
  });

  it("uses the current line when short", () => {
    expect(excerptAround("one\nretry budget here\nthree", 10, 10)).toBe("retry budget here");
  });

  it("finds a quote in the document", () => {
    expect(findExcerpt("aaa retry budget bbb", "retry budget")).toEqual({ from: 4, to: 16 });
    expect(findExcerpt("aaa", "nope")).toBeNull();
  });

  it("labels age", () => {
    const now = Date.parse("2026-08-22T16:00:00Z");
    expect(ageLabel("2026-08-22T15:58:00Z", now)).toBe("2 min ago");
  });
});
