import { describe, expect, it } from "vitest";
import { buildPageItems, completeWiki, detectTrigger } from "./suggest";

describe("suggest", () => {
  it("opens commands after a line-start or spaced slash", () => {
    expect(detectTrigger("/da", 3)).toMatchObject({ mode: "command", from: 0, query: "da" });
    expect(detectTrigger("see /page", 9)).toMatchObject({ mode: "command", from: 4, query: "page" });
    expect(detectTrigger("https://x", 8)).toBeNull();
    expect(detectTrigger("ideas/foo", 9)).toBeNull();
  });

  it("opens page mode on [[ and prefers it over slash", () => {
    expect(detectTrigger("[[On", 4)).toMatchObject({ mode: "page", from: 0, query: "On" });
    expect(detectTrigger("see [[ideas/a", 13)).toMatchObject({ mode: "page", query: "ideas/a" });
    expect(detectTrigger("[[One]]", 7)).toBeNull();
    expect(detectTrigger("[[One|", 6)).toBeNull();
    expect(detectTrigger("[[a\nb", 5)).toBeNull();
  });

  it("builds page rows and a new-page create item", () => {
    const notes = [{ id: "1", title: "One", folder: "ideas", modified_at: "" }];
    expect(buildPageItems("On", notes)).toMatchObject([
      { type: "note", path: "ideas/One" },
      { type: "create", path: "On" },
    ]);
    expect(buildPageItems("ideas/One", notes)).toMatchObject([{ type: "note", path: "ideas/One" }]);
    expect(buildPageItems("", notes)).toMatchObject([{ type: "note", path: "ideas/One" }]);
  });

  it("closes a wiki path", () => {
    expect(completeWiki("ideas/One")).toBe("[[ideas/One]]");
  });
});
