import MarkdownIt from "markdown-it";
import { escapeHtml, linkifyWiki } from "./wiki";
import { normalizeTag } from "./tags";

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
});

const image = md.renderer.rules.image;
md.renderer.rules.image = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const src = token.attrGet("src") ?? "";
  const id = src.match(/^mnote-asset:([A-Za-z0-9-]+)$/)?.[1];
  if (!id) return image ? image(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options);
  token.attrSet("src", `/api/assets/${id}`);
  token.attrSet("data-asset-id", id);
  token.attrJoin("class", "asset-image");
  return self.renderToken(tokens, idx, options);
};

export function renderMarkdown(source: string): string {
  return linkifyTags(linkifyWiki(md.render(source)));
}

const TAG_LINK_RE = /(^|[^A-Za-z0-9-])#([A-Za-z][A-Za-z0-9-]{0,31})\b/g;

export function linkifyTags(html: string): string {
  return html.replace(TAG_LINK_RE, (full, pre: string, name: string) => {
    const tag = normalizeTag(name);
    if (!tag) return full;
    return `${pre}<a href="/search?q=${encodeURIComponent(`#${tag}`)}" data-tag="${escapeHtml(tag)}">#${escapeHtml(tag)}</a>`;
  });
}
