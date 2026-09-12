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

  it("resolves relative asset paths at render time", () => {
    const html = renderMarkdown("![Harbor](../assets/image/018f0a20-7d2b-7d75-a5d2-cb7b4fb6e57c/dot.png)");
    expect(html).toContain('src="/api/assets/018f0a20-7d2b-7d75-a5d2-cb7b4fb6e57c"');
  });

  it("renders task list checkboxes", () => {
    const html = renderMarkdown("- [ ] one\n- [x] two\n  - [ ] nested");
    expect(html).toContain('class="task-list-item"');
    expect(html).toContain('data-task-line="0"');
    expect(html).toContain('data-task-line="1"');
    expect(html).toContain('data-task-line="2"');
    expect(html).toContain("checked");
    expect(html).toContain("one");
    expect(html).not.toContain("[ ]");
    expect(html).not.toContain("[x]");
  });

  it("keeps wiki links inside task items", () => {
    const html = renderMarkdown("- [ ] see [[page]]");
    expect(html).toContain('data-task-line="0"');
    expect(html).toContain('data-wiki="page"');
  });

  it("does not treat fenced tasks as checkboxes", () => {
    const html = renderMarkdown("```\n- [ ] no\n```\n- [ ] yes");
    expect(html).toContain("- [ ] no");
    expect(html.match(/task-checkbox/g)?.length).toBe(1);
    expect(html).toContain('data-task-line="3"');
  });

  it("keeps a leading hashtag on the checkbox line", () => {
    const html = renderMarkdown("- [ ] #mnote");
    expect(html).toContain('data-tag="mnote"');
    expect(html).toMatch(/task-checkbox[^>]*>\s*<a [^>]*data-tag="mnote"/);
    expect(html).not.toMatch(/task-checkbox[^>]*>\s*<p>/);
  });

  it("keeps the checkbox inside the paragraph in a loose task list", () => {
    const html = renderMarkdown("- [ ] #mnote\n\n  - nested");
    expect(html).toMatch(/<p>\s*<input type="checkbox" class="task-checkbox"[^>]*>\s*<a [^>]*data-tag="mnote"/);
  });
});
