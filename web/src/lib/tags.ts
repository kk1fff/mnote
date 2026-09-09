import { ref } from "vue";

const TAG_RE = /^[a-z][a-z0-9-]{0,31}$/;

export function normalizeTag(raw: string): string | null {
  const s = raw.trim().replace(/^#+/, "").toLowerCase();
  if (!TAG_RE.test(s) || s.includes("--") || s.endsWith("-")) return null;
  return s;
}

export type TagQuery = {
  here: boolean;
  chain: string[];
  needle: string;
};

export function parseTagQuery(raw: string): TagQuery | null {
  const q = raw.trim();
  let here = false;
  let rest = q;
  if (rest.startsWith(">")) {
    here = true;
    rest = rest.slice(1).trimStart();
  }
  if (!rest) {
    return here ? { here, chain: [], needle: "" } : null;
  }
  if (!rest.startsWith("#")) return null;
  const parts = rest.split(">").map((part) => part.trim());
  const chain: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const last = i === parts.length - 1;
    const part = parts[i];
    if (!part) {
      if (last) return { here, chain, needle: "" };
      return null;
    }
    if (!part.startsWith("#")) return null;
    const name = part.slice(1);
    if (/\s/.test(name)) return null;
    if (last) return { here, chain, needle: name.toLowerCase() };
    const tag = normalizeTag(name);
    if (!tag) return null;
    chain.push(tag);
  }
  return null;
}

export function formatTagQuery(here: boolean, chain: string[], last?: string): string {
  const tags = last ? [...chain, last] : [...chain];
  const body = tags.map((tag) => `#${tag}`).join(" > ");
  if (here) return body ? `> ${body}` : ">";
  return body;
}

export function isTagQueryInput(raw: string): boolean {
  return parseTagQuery(raw) != null;
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

function parseTagAt(rest: string): string | null {
  let len = 0;
  for (const c of rest) {
    if (len === 0) {
      if (!/[a-zA-Z]/.test(c)) return null;
    } else if (!/[a-zA-Z0-9-]/.test(c)) {
      break;
    }
    len += 1;
    if (len > 32) return null;
  }
  return len ? normalizeTag(rest.slice(0, len)) : null;
}

function isTagBoundary(c: string): boolean {
  return /\s/.test(c) || "([{'\"".includes(c);
}

export function extractHashtags(content: string): string[] {
  const tags: string[] = [];
  let inFence = false;
  for (const line of content.split("\n")) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    let scan = line;
    const hashes = trimmed.match(/^#{1,6}([ \t]|$)/);
    if (hashes) scan = trimmed.slice(hashes[0].length);
    let inCode = false;
    for (let i = 0; i < scan.length; i++) {
      const ch = scan[i];
      if (ch === "`") {
        inCode = !inCode;
        continue;
      }
      if (inCode || ch !== "#") continue;
      if (i > 0 && !isTagBoundary(scan[i - 1])) continue;
      const tag = parseTagAt(scan.slice(i + 1));
      if (!tag) continue;
      if (!tags.includes(tag)) tags.push(tag);
      i += tag.length;
    }
  }
  return tags;
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

export const pendingTagReveal = ref<{ id: string; from: number; to: number } | null>(null);

let openTagFn: ((tag: string) => void) | null = null;

export function registerTagOpen(fn: ((tag: string) => void) | null) {
  openTagFn = fn;
}

export function openTag(tag: string) {
  const name = normalizeTag(tag);
  if (name) openTagFn?.(name);
}
