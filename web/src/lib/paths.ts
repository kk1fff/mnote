export function todayDate(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function noteHref(id: string, opts?: { beside?: string }): string {
  const path = `/n/${encodeURIComponent(id)}`;
  if (!opts?.beside) return path;
  return `${path}?beside=${encodeURIComponent(opts.beside)}`;
}

export function queryValue(param: unknown): string {
  const raw = Array.isArray(param) ? param[0] : param;
  if (raw == null || raw === "") return "";
  try {
    return decodeURIComponent(String(raw));
  } catch {
    return String(raw);
  }
}

export function noteIdFromRoute(param: unknown): string {
  return queryValue(param);
}

export function wikiPath(folder: string, title: string): string {
  return folder ? `${folder}/${title}` : title;
}

export function parseWikiPath(target: string): { title: string; folder: string } | null {
  return parseCreateQuery(target);
}

export function sameWikiPath(folder: string, title: string, target: string): boolean {
  return wikiPath(folder, title).toLowerCase() === target.trim().toLowerCase();
}

export function parseCreateQuery(raw: string): { title: string; folder: string } | null {
  const trimmed = raw.trim().replace(/^\/+/, "").replace(/\.md$/i, "");
  if (!trimmed || trimmed.includes("\\") || trimmed.includes("\0") || trimmed.length > 200) {
    return null;
  }
  const parts = trimmed
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part && part !== ".");
  if (!parts.length || parts.some((part) => part === ".." || part.includes("\0"))) {
    return null;
  }
  const title = parts[parts.length - 1];
  const folder = parts.slice(0, -1).join("/");
  return { title, folder };
}

export function noteFolderLabel(note: { folder?: string }): string {
  return note.folder ?? "";
}
