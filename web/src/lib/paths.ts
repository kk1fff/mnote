export function todayPath(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function isDailyPath(path: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(path);
}

export function normalizeNotePath(raw: string): string | null {
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
  return parts.join("/");
}

export function noteHref(path: string): string {
  return `/n/${path
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/")}`;
}

export function decodeNotePath(raw: string): string {
  return raw
    .split("/")
    .filter(Boolean)
    .map((part) => decodeURIComponent(part))
    .join("/");
}

export function pathFromRouteParam(param: unknown): string {
  if (Array.isArray(param)) {
    return param.map((part) => decodeURIComponent(String(part))).filter(Boolean).join("/");
  }
  return decodeNotePath(String(param ?? ""));
}
