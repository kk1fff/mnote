const TAG_RE = /^[a-z][a-z0-9-]{0,31}$/;

export function normalizeTag(raw: string): string | null {
  const s = raw.trim().replace(/^#+/, "").toLowerCase();
  if (!TAG_RE.test(s) || s.includes("--") || s.endsWith("-")) return null;
  return s;
}

export function parseTagsField(raw: string): string[] {
  return uniqueTags(
    raw
      .trim()
      .replace(/^\[|\]$/g, "")
      .split(",")
      .map((part) => normalizeTag(part.trim()))
      .filter((tag): tag is string => !!tag),
  );
}

export function uniqueTags(tags: string[]): string[] {
  const out: string[] = [];
  for (const tag of tags) {
    if (!out.includes(tag)) out.push(tag);
  }
  return out;
}

export function formatTagLabel(tag: string): string {
  return `#${tag}`;
}

export function tagsFromNotes(notes: { tags?: string[] }[]): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const note of notes) {
    for (const tag of note.tags ?? []) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function noteHasTag(note: { tags?: string[] }, tag: string): boolean {
  return (note.tags ?? []).includes(tag);
}

let openTagFn: ((tag: string) => void) | null = null;

export function registerTagOpen(fn: ((tag: string) => void) | null) {
  openTagFn = fn;
}

export function openTag(tag: string) {
  const name = normalizeTag(tag);
  if (name) openTagFn?.(name);
}
