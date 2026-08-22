import MarkdownIt from "markdown-it";
import { linkifyWiki } from "./wiki";

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
});

export function renderMarkdown(source: string): string {
  return linkifyWiki(md.render(source));
}
