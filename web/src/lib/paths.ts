export function todayPath(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function isDailyPath(path: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(path);
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
