import { describe, expect, it } from "vitest";
import {
  decodeNotePath,
  isDailyPath,
  normalizeNotePath,
  noteHref,
  pathFromRouteParam,
  todayPath,
} from "./paths";

describe("paths", () => {
  it("formats today as YYYY-MM-DD", () => {
    expect(todayPath(new Date("2026-08-22T15:00:00"))).toBe("2026-08-22");
  });

  it("detects daily notes", () => {
    expect(isDailyPath("2026-08-22")).toBe(true);
    expect(isDailyPath("ideas/one")).toBe(false);
  });

  it("normalizes note paths", () => {
    expect(normalizeNotePath(" /ideas/one.md ")).toBe("ideas/one");
    expect(normalizeNotePath("a / b")).toBe("a/b");
    expect(normalizeNotePath("../x")).toBeNull();
    expect(normalizeNotePath("")).toBeNull();
  });

  it("encodes and decodes note paths", () => {
    expect(noteHref("ideas/one")).toBe("/n/ideas/one");
    expect(noteHref("a b/c")).toBe("/n/a%20b/c");
    expect(decodeNotePath("/ideas/one")).toBe("ideas/one");
    expect(decodeNotePath("a%20b/c")).toBe("a b/c");
    expect(pathFromRouteParam(["ideas", "one"])).toBe("ideas/one");
    expect(pathFromRouteParam("ideas/one")).toBe("ideas/one");
    expect(pathFromRouteParam(undefined)).toBe("");
  });
});
