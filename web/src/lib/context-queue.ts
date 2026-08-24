import type { ContextStamp } from "./context";

export type QueuedEvent = ContextStamp & {
  tmp_id: string;
  ordinal: number;
  source: "auto" | "where";
};

const memory = new Map<string, string>();
const CAP = 200;

function key(noteId: string): string {
  return `mnote:context:${noteId}`;
}

function read(name: string): string | null {
  try {
    if (typeof localStorage !== "undefined") return localStorage.getItem(name);
  } catch {
    /* memory */
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
    /* memory */
  }
  if (value === null) memory.delete(name);
  else memory.set(name, value);
}

export function loadQueue(noteId: string): QueuedEvent[] {
  const raw = read(key(noteId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as QueuedEvent[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveQueue(noteId: string, events: QueuedEvent[]) {
  const next = events.slice(-CAP);
  if (!next.length) write(key(noteId), null);
  else write(key(noteId), JSON.stringify(next));
}

export function enqueue(noteId: string, event: QueuedEvent) {
  const events = loadQueue(noteId);
  events.push(event);
  saveQueue(noteId, events);
}

export function clearQueue(noteId: string) {
  write(key(noteId), null);
}

export function newTmpId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
