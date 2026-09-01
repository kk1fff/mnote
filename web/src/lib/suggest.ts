import type { NoteMeta } from "../api";
import { parseCreateQuery, wikiPath } from "./paths";

export type SuggestTrigger = {
  mode: "command" | "page" | "tag";
  from: number;
  queryFrom: number;
  query: string;
};

export type PageSuggestItem =
  | { type: "note"; key: string; note: NoteMeta; path: string }
  | { type: "create"; key: "create"; path: string; draft: { title: string; folder: string } };

export function detectTrigger(doc: string, cursor: number): SuggestTrigger | null {
  const at = Math.max(0, Math.min(cursor, doc.length));
  const before = doc.slice(0, at);

  const wiki = before.lastIndexOf("[[");
  if (wiki >= 0) {
    const after = before.slice(wiki + 2);
    if (!after.includes("]]") && !after.includes("\n") && !after.includes("|")) {
      return { mode: "page", from: wiki, queryFrom: wiki + 2, query: after };
    }
  }

  const tag = detectHashtag(doc, at);
  if (tag) return tag;

  const lineStart = before.lastIndexOf("\n") + 1;
  const line = before.slice(lineStart);
  const slash = line.lastIndexOf("/");
  if (slash < 0) return null;
  const from = lineStart + slash;
  const prev = from === 0 ? "" : (doc[from - 1] ?? "");
  if (from !== lineStart && !/\s/.test(prev)) return null;
  return { mode: "command", from, queryFrom: from + 1, query: line.slice(slash + 1) };
}

export function buildPageItems(query: string, notes: NoteMeta[]): PageSuggestItem[] {
  const items: PageSuggestItem[] = notes.map((note) => ({
    type: "note",
    key: note.id,
    note,
    path: wikiPath(note.folder ?? "", note.title),
  }));
  const draft = parseCreateQuery(query);
  if (!draft || !query.trim()) return items;
  const exists = notes.some(
    (note) =>
      (note.folder ?? "").toLowerCase() === draft.folder.toLowerCase() &&
      note.title.toLowerCase() === draft.title.toLowerCase(),
  );
  if (!exists) {
    items.push({
      type: "create",
      key: "create",
      path: wikiPath(draft.folder, draft.title),
      draft,
    });
  }
  return items;
}

export function completeWiki(path: string): string {
  return `[[${path}]]`;
}

export function completeTag(name: string): string {
  return `#${name}`;
}

function detectHashtag(doc: string, cursor: number): SuggestTrigger | null {
  const before = doc.slice(0, cursor);
  const lineStart = before.lastIndexOf("\n") + 1;
  const line = before.slice(lineStart);
  const heading = line.match(/^(#{1,6})[ \t]/);
  const hash = line.lastIndexOf("#");
  if (hash < 0) return null;
  if (heading && hash < heading[1].length) return null;
  if (hash > 0 && !/[\s([{`'"]/.test(line[hash - 1] ?? "")) return null;
  const query = line.slice(hash + 1);
  if (!/^[A-Za-z0-9-]*$/.test(query)) return null;
  const ticks = line.slice(0, hash).split("`").length - 1;
  if (ticks % 2 === 1) return null;
  return { mode: "tag", from: lineStart + hash, queryFrom: lineStart + hash + 1, query };
}
