import { describe, expect, it } from "vitest";
import { threeWay } from "./merge";

describe("threeWay", () => {
  it("takes the only changed side", () => {
    expect(threeWay("a", "a", "b")).toEqual({ content: "b", conflict: false });
    expect(threeWay("a", "b", "a")).toEqual({ content: "b", conflict: false });
    expect(threeWay("a", "b", "b")).toEqual({ content: "b", conflict: false });
  });

  it("merges non-overlapping line edits", () => {
    expect(threeWay("one\ntwo\nthree\nfour", "ONE\ntwo\nthree\nfour", "one\ntwo\nthree\nFOUR")).toEqual({
      content: "ONE\ntwo\nthree\nFOUR",
      conflict: false,
    });
  });

  it("keeps both sides on overlap", () => {
    const merged = threeWay("hello\n", "alpha\n", "beta\n");
    expect(merged.conflict).toBe(true);
    expect(merged.content).toContain("<<<<<<< this device");
    expect(merged.content).toContain("alpha");
    expect(merged.content).toContain("beta");
  });
});
