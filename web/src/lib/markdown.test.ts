import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdown";

describe("markdown", () => {
  it("renders headings and wiki links", () => {
    const html = renderMarkdown("# Hi\n\nsee [[page]]");
    expect(html).toContain("<h1>Hi</h1>");
    expect(html).toContain('href="/n/page"');
  });

  it("does not render raw html", () => {
    expect(renderMarkdown("<script>alert(1)</script>")).not.toContain("<script>");
  });
});
