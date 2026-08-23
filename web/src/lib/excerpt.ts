export function excerptAround(content: string, from: number, to: number, max = 160): string {
  const startSel = Math.max(0, Math.min(from, to, content.length));
  const endSel = Math.max(0, Math.min(Math.max(from, to), content.length));
  if (endSel > startSel) {
    return content.slice(startSel, endSel).slice(0, 400).trim();
  }
  const caret = startSel;
  const lineStart = content.lastIndexOf("\n", Math.max(0, caret - 1)) + 1;
  const nl = content.indexOf("\n", caret);
  const lineEnd = nl < 0 ? content.length : nl;
  if (lineEnd - lineStart <= max) {
    return content.slice(lineStart, lineEnd).trim();
  }
  let start = Math.max(lineStart, caret - Math.floor(max / 2));
  let end = Math.min(lineEnd, start + max);
  start = Math.max(lineStart, end - max);
  return content.slice(start, end).trim();
}

export function findExcerpt(content: string, excerpt: string): { from: number; to: number } | null {
  const needle = excerpt.trim();
  if (!needle) return null;
  const i = content.indexOf(needle);
  if (i < 0) return null;
  return { from: i, to: i + needle.length };
}

export function ageLabel(iso: string, now = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const min = Math.max(0, Math.round((now - then) / 60_000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}
