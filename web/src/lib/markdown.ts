import MarkdownIt from "markdown-it";
import { linkifyWiki } from "./wiki";

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
  return linkifyWiki(md.render(source));
}
