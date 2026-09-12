import MarkdownIt from "markdown-it";
import { escapeHtml, linkifyWiki } from "./wiki";
import { normalizeTag } from "./tags";
import { parseTablesFromSource } from "./tables";

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
}).enable("table");

// Allow the one inline HTML element needed for line breaks in pipe-table cells.
// Other HTML remains escaped by MarkdownIt.
md.inline.ruler.before("html_inline", "cell_break", (state, silent) => {
  const match = /^<br\s*\/?\s*>/i.exec(state.src.slice(state.pos));
  if (!match) return false;
  if (!silent) state.push("hardbreak", "br", 0);
  state.pos += match[0].length;
  return true;
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
    const line = token.map ? String(token.map[0]) : "";
    if (line) token.attrSet("data-task-line", line);
    inline.content = inline.content.slice(prefix.length);
    const first = inline.children?.[0];
    if (first?.type === "text" && first.content.startsWith(prefix)) {
      first.content = first.content.slice(prefix.length);
      if (!first.content) inline.children?.splice(0, 1);
    }
    const box = new state.Token("html_inline", "", 0);
    const checked = mark[1] === " " ? "" : " checked";
    box.content = `<input type="checkbox" class="task-checkbox" data-task-line="${escapeHtml(line)}"${checked}>`;
    inline.children ??= [];
    inline.children.unshift(box);
  }
});

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

const tableOpen = md.renderer.rules.table_open;
md.renderer.rules.table_open = (tokens, idx, options, env, self) =>
  `<div class="preview-table">${tableOpen ? tableOpen(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options)}`;
const tableClose = md.renderer.rules.table_close;
md.renderer.rules.table_close = (tokens, idx, options, env, self) =>
  `${tableClose ? tableClose(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options)}</div>`;

export function renderMarkdown(source: string): string {
  // The source table parser treats wiki aliases as a single cell. GFM needs
  // their pipes escaped during rendering as well; never rewrite the note.
  const lines = source.split("\n");
  const tables = parseTablesFromSource(source);
  for (const table of tables) {
    for (let line = table.fromLine; line <= table.toLine; line++) {
      lines[line - 1] = lines[line - 1].replace(/\[\[[^\]\n]+\]\]/g, wiki => wiki.replace(/(?<!\\)\|/g, "\\|"));
    }
  }
  // markdown-it only starts a table at a block boundary. Source mode still
  // shades a table that follows a paragraph, so insert a blank line in the
  // render copy only.
  for (let i = tables.length - 1; i >= 0; i -= 1) {
    const at = tables[i].fromLine - 1;
    if (at > 0 && (lines[at - 1] ?? "").trim() !== "") lines.splice(at, 0, "");
  }
  return linkifyTags(linkifyWiki(md.render(lines.join("\n"))));
}

export function renderTableCell(source: string): string {
  return linkifyTags(linkifyWiki(md.renderInline(source)));
}

const TAG_LINK_RE = /(^|[^A-Za-z0-9-])#([A-Za-z][A-Za-z0-9-]{0,31})\b/g;

export function linkifyTags(html: string): string {
  return html.replace(TAG_LINK_RE, (full, pre: string, name: string) => {
    const tag = normalizeTag(name);
    if (!tag) return full;
    return `${pre}<a href="/search?q=${encodeURIComponent(`#${tag}`)}" data-tag="${escapeHtml(tag)}">#${escapeHtml(tag)}</a>`;
  });
}
