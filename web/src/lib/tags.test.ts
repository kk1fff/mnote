import { describe, expect, it } from "vitest";
import {
  extractHashtags,
  formatTagLabel,
  formatTagQuery,
  normalizeTag,
  parseTagQuery,
  parseTagsField,
  tagsFromNotes,
  uniqueTags,
} from "./tags";

describe("tags", () => {
  it("normalizes and rejects invalid names", () => {
    expect(normalizeTag("#Work")).toBe("work");
    expect(normalizeTag(" meeting ")).toBe("meeting");
    expect(normalizeTag("# Title")).toBeNull();
    expect(normalizeTag("1abc")).toBeNull();
    expect(normalizeTag("work-")).toBeNull();
  });

  it("parses a comma field and keeps order", () => {
    expect(parseTagsField("work, Meeting, work")).toEqual(["work", "meeting"]);
    expect(uniqueTags(["a", "a", "b"])).toEqual(["a", "b"]);
    expect(formatTagLabel("work")).toBe("#work");
  });

  it("extracts hashtags and skips headings and code", () => {
    expect(extractHashtags("see #Work today\nlater #work again")).toEqual(["work"]);
    expect(
      extractHashtags("# Title\n\nsee #work and #Meeting\n\n```\n#code\n```\n\n`#skip` and (#rust)\n"),
    ).toEqual(["work", "meeting", "rust"]);
    expect(extractHashtags("# 2026-08-31\n\n")).toEqual([]);
  });

  it("parses structured tag queries", () => {
    expect(parseTagQuery("#work")).toEqual({ here: false, chain: [], needle: "work" });
    expect(parseTagQuery("> #work")).toEqual({ here: true, chain: [], needle: "work" });
    expect(parseTagQuery(">")).toEqual({ here: true, chain: [], needle: "" });
    expect(parseTagQuery("#work > #meeting")).toEqual({
      here: false,
      chain: ["work"],
      needle: "meeting",
    });
    expect(parseTagQuery("#work >")).toEqual({ here: false, chain: ["work"], needle: "" });
    expect(parseTagQuery("#work extra")).toBeNull();
    expect(parseTagQuery("> work")).toBeNull();
    expect(formatTagQuery(true, [], "work")).toBe("> #work");
    expect(formatTagQuery(false, ["work"], "meeting")).toBe("#work > #meeting");
    expect(formatTagQuery(true, [])).toBe(">");
  });

  it("counts tags across notes", () => {
    expect(
      tagsFromNotes([
        { tags: ["work", "meeting"] },
        { tags: ["work"] },
        { tags: [] },
      ]),
    ).toEqual([
      { name: "meeting", count: 1 },
      { name: "work", count: 2 },
    ]);
  });
});
