export interface Draft {
  base: string;
  local: string;
}

const memory = new Map<string, string>();

function key(path: string): string {
  return `mnote:draft:${path}`;
}

function read(name: string): string | null {
  try {
    if (typeof localStorage !== "undefined") return localStorage.getItem(name);
  } catch {
    /* use memory */
  }
  return memory.get(name) ?? null;
}

function write(name: string, value: string | null) {
  try {
    if (typeof localStorage !== "undefined") {
      if (value === null) localStorage.removeItem(name);
      else localStorage.setItem(name, value);
      return;
    }
  } catch {
    /* use memory */
  }
  if (value === null) memory.delete(name);
  else memory.set(name, value);
}

export function saveDraft(path: string, base: string, local: string) {
  if (local === base) {
    write(key(path), null);
    return;
  }
  write(key(path), JSON.stringify({ base, local } satisfies Draft));
}

export function loadDraft(path: string): Draft | null {
  const raw = read(key(path));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Draft;
    if (typeof parsed.base === "string" && typeof parsed.local === "string") return parsed;
  } catch {
    return null;
  }
  return null;
}

export function clearDraft(path: string) {
  write(key(path), null);
}
