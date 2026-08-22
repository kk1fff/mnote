import type { NoteMeta } from "../api";

export type TreeNode =
  | { kind: "folder"; name: string; path: string; children: TreeNode[] }
  | { kind: "note"; name: string; note: NoteMeta };

interface Draft {
  folders: Map<string, Draft>;
  notes: NoteMeta[];
}

function emptyDraft(): Draft {
  return { folders: new Map(), notes: [] };
}

function insert(draft: Draft, parts: string[], note: NoteMeta) {
  if (parts.length === 0) {
    draft.notes.push(note);
    return;
  }
  const [head, ...rest] = parts;
  let child = draft.folders.get(head);
  if (!child) {
    child = emptyDraft();
    draft.folders.set(head, child);
  }
  insert(child, rest, note);
}

function flatten(draft: Draft, prefix: string): TreeNode[] {
  const folders = [...draft.folders.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, child]) => {
      const path = prefix ? `${prefix}/${name}` : name;
      return {
        kind: "folder" as const,
        name,
        path,
        children: flatten(child, path),
      };
    });
  const notes = draft.notes
    .slice()
    .sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id))
    .map((note) => ({ kind: "note" as const, name: note.title, note }));
  return [...folders, ...notes];
}

export function noteTree(notes: NoteMeta[]): TreeNode[] {
  const root = emptyDraft();
  for (const note of notes) {
    const parts = (note.folder ?? "").split("/").filter(Boolean);
    insert(root, parts, note);
  }
  return flatten(root, "");
}
