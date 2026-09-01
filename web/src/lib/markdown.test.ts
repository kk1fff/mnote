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

  it("linkifies hashtags", () => {
    const html = renderMarkdown("see #work today");
    expect(html).toContain('data-tag="work"');
    expect(html).toContain("#work");
  });

  it("resolves stable asset embeds at render time", () => {
    const html = renderMarkdown("![Harbor](mnote-asset:018f0a20-7d2b-7d75-a5d2-cb7b4fb6e57c)");
    expect(html).toContain('src="/api/assets/018f0a20-7d2b-7d75-a5d2-cb7b4fb6e57c"');
    expect(html).toContain('data-asset-id="018f0a20-7d2b-7d75-a5d2-cb7b4fb6e57c"');
  });
});
