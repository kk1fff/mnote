import MarkdownIt from "markdown-it";
import { escapeHtml, linkifyWiki } from "./wiki";
import { normalizeTag } from "./tags";

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
});

md.core.ruler.after("inline", "task_lists", (state) => {
  for (let i = 0; i < state.tokens.length; i += 1) {
    const token = state.tokens[i];
    if (token.type !== "list_item_open") continue;
    let j = i + 1;
    if (state.tokens[j]?.type === "paragraph_open") j += 1;
    const inline = state.tokens[j];
    if (inline?.type !== "inline") continue;
    const mark = /^\[([ xX])\](?:\s|$)/.exec(inline.content);
    if (!mark) continue;
    const prefix = mark[0];
    token.attrJoin("class", "task-list-item");
    if (token.map) token.attrSet("data-task-line", String(token.map[0]));
    token.attrSet("data-checked", mark[1] === " " ? "false" : "true");
    inline.content = inline.content.slice(prefix.length);
    const first = inline.children?.[0];
    if (first?.type === "text" && first.content.startsWith(prefix)) {
      first.content = first.content.slice(prefix.length);
      if (!first.content) inline.children?.splice(0, 1);
    }
  }
});

const listItemOpen = md.renderer.rules.list_item_open;
md.renderer.rules.list_item_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const html = listItemOpen ? listItemOpen(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options);
  const line = token.attrGet("data-task-line");
  if (line == null) return html;
  const checked = token.attrGet("data-checked") === "true" ? " checked" : "";
  return `${html}<input type="checkbox" class="task-checkbox" data-task-line="${escapeHtml(line)}"${checked}>`;
};

const image = md.renderer.rules.image;
md.renderer.rules.image = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const src = token.attrGet("src") ?? "";
  const legacy = src.match(/^mnote-asset:([A-Za-z0-9-]+)$/)?.[1];
  const relative = src.match(/(?:^|\/)assets\/(?:[^/]+\/)?([A-Za-z0-9-]+)\/[^/]+$/)?.[1];
  const id = legacy || relative;
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
