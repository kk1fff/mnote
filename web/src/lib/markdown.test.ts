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

  it("keeps checkboxes on the same line as task text in loose lists", () => {
    const html = renderMarkdown("- [ ] one\n\n- [x] two");
    expect(html).toMatch(/<p><input type="checkbox" class="task-checkbox" data-task-line="0">one<\/p>/);
    expect(html).toMatch(/<p><input type="checkbox" class="task-checkbox" data-task-line="2" checked>two<\/p>/);
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
});
