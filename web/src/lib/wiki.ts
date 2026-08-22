export interface WikiLink {
  target: string;
  label: string;
}

const WIKI_RE = /\[\[([^[\]]+)\]\]/g;

export function parseWikiLinks(content: string): WikiLink[] {
  const links: WikiLink[] = [];
  for (const match of content.matchAll(WIKI_RE)) {
    const inner = match[1] ?? "";
    const [targetRaw, labelRaw] = inner.split("|");
    const target = (targetRaw ?? "").trim();
    if (!target || target.includes("..")) continue;
    links.push({
      target,
      label: (labelRaw ?? targetRaw ?? "").trim() || target,
    });
  }
  return links;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function linkifyWiki(html: string): string {
  return html.replace(WIKI_RE, (_full, inner: string) => {
    const [targetRaw, labelRaw] = inner.split("|");
    const target = (targetRaw ?? "").trim();
    if (!target || target.includes("..")) return escapeHtml(_full);
    const label = (labelRaw ?? targetRaw ?? "").trim() || target;
    const href = `/n/${target
      .split("/")
      .map((part) => encodeURIComponent(part))
      .join("/")}`;
    return `<a href="${href}" data-wiki="${escapeHtml(target)}">${escapeHtml(label)}</a>`;
  });
}
