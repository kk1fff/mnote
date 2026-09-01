import { describe, expect, it } from "vitest";
import { formatTagLabel, normalizeTag, parseTagsField, tagsFromNotes, uniqueTags } from "./tags";

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
