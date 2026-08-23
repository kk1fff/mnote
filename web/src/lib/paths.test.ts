import { describe, expect, it } from "vitest";
import { noteHref, noteIdFromRoute, parseCreateQuery, parseWikiPath, sameWikiPath, todayDate, wikiPath } from "./paths";

describe("paths", () => {
  it("formats today as YYYY-MM-DD", () => {
    expect(todayDate(new Date("2026-08-22T15:00:00"))).toBe("2026-08-22");
  });

  it("parses create queries", () => {
    expect(parseCreateQuery(" /ideas/one.md ")).toEqual({ title: "one", folder: "ideas" });
    expect(parseCreateQuery("a / b")).toEqual({ title: "b", folder: "a" });
    expect(parseCreateQuery("plan")).toEqual({ title: "plan", folder: "" });
    expect(parseCreateQuery("../x")).toBeNull();
    expect(parseCreateQuery("")).toBeNull();
  });

  it("builds wiki paths", () => {
    expect(wikiPath("ideas", "One")).toBe("ideas/One");
    expect(wikiPath("", "One")).toBe("One");
    expect(parseWikiPath("ideas/One")).toEqual({ title: "One", folder: "ideas" });
    expect(sameWikiPath("ideas", "One", "ideas/one")).toBe(true);
    expect(sameWikiPath("", "One", "ideas/One")).toBe(false);
  });

  it("encodes note ids", () => {
    expect(noteHref("abc")).toBe("/n/abc");
    expect(noteHref("a b")).toBe("/n/a%20b");
    expect(noteIdFromRoute("abc")).toBe("abc");
    expect(noteIdFromRoute("a%20b")).toBe("a b");
    expect(noteIdFromRoute(undefined)).toBe("");
  });
});
