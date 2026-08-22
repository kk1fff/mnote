import { describe, expect, it } from "vitest";
import { escapeHtml, linkifyWiki, parseWikiLinks } from "./wiki";

describe("wiki", () => {
  it("parses targets and labels", () => {
    expect(parseWikiLinks("see [[beta|B]] and [[ideas/one]]")).toEqual([
      { target: "beta", label: "B" },
      { target: "ideas/one", label: "ideas/one" },
    ]);
  });

  it("skips traversal links", () => {
    expect(parseWikiLinks("[[../secret]]")).toEqual([]);
  });

  it("escapes html", () => {
    expect(escapeHtml(`<a ">`)).toBe("&lt;a &quot;&gt;");
  });

  it("turns wiki links into anchors", () => {
    const html = linkifyWiki("<p>see [[beta|B]]</p>");
    expect(html).toContain('href="/n/beta"');
    expect(html).toContain("data-wiki=\"beta\"");
    expect(html).toContain(">B</a>");
  });

  it("leaves unsafe wiki text escaped", () => {
    expect(linkifyWiki("[[../x]]")).toContain("[[../x]]");
    expect(linkifyWiki("[[../x]]")).not.toContain("<a ");
  });
});
