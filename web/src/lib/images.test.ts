import { describe, expect, it } from "vitest";
import { assetMarkdown, imageFileFromList, insertAt, isAllowedImage } from "./images";

describe("images", () => {
  it("picks the first image item", () => {
    const file = new File(["x"], "a.png", { type: "image/png" });
    const items = [
      { type: "text/plain", getAsFile: () => null },
      { type: "image/png", getAsFile: () => file },
    ];
    expect(imageFileFromList(items)).toBe(file);
    expect(imageFileFromList([])).toBeNull();
  });

  it("inserts markdown with spacing", () => {
    expect(insertAt("hello", 5, "![](a)")).toBe("hello\n![](a)");
    expect(insertAt("hello", 2, "X")).toBe("he\nX\nllo");
    expect(insertAt("", 0, "X")).toBe("X");
  });

  it("builds relative asset markdown", () => {
    expect(
      assetMarkdown(
        { id: "abc", filename: "dot.png", group: "image", path: "assets/image/abc/dot.png" },
        "",
      ),
    ).toBe("![](../assets/image/abc/dot.png)");
    expect(
      assetMarkdown(
        { id: "abc", filename: "dot.png", group: "image", path: "assets/image/abc/dot.png" },
        "ideas",
      ),
    ).toBe("![](../../assets/image/abc/dot.png)");
  });

  it("allows common image types", () => {
    expect(isAllowedImage(new File([], "a.png", { type: "image/png" }))).toBe(true);
    expect(isAllowedImage(new File([], "a.jpg", { type: "" }))).toBe(true);
    expect(isAllowedImage(new File([], "a.txt", { type: "text/plain" }))).toBe(false);
  });
});
