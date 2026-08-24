import type { NoteMeta } from "../api";
import { parseCreateQuery } from "./paths";

export type PickerCollection = "recent" | "favorites";

export type PickerSectionId = "goto" | "note" | "folder" | "create" | PickerCollection;

export type PickerItem =
  | { type: "jump"; key: string; to: string; label: string }
  | { type: "collection"; key: PickerCollection; label: string }
  | { type: "back"; key: "back" }
  | { type: "note"; key: string; note: NoteMeta }
  | { type: "folder"; key: string; path: string }
  | { type: "search-folder"; key: "search-folder" }
  | { type: "create"; key: "create"; draft: { title: string; folder: string }; label: string };

const JUMPS: Extract<PickerItem, { type: "jump" }>[] = [
  { type: "jump", key: "today", to: "/today", label: "Today" },
];

const COLLECTIONS: Extract<PickerItem, { type: "collection" }>[] = [
  { type: "collection", key: "recent", label: "Recent" },
  { type: "collection", key: "favorites", label: "Favorites" },
];

const GOTO_ITEMS: PickerItem[] = [...JUMPS, ...COLLECTIONS];

export interface PickerSection {
  id: PickerSectionId;
  label: string;
  items: PickerItem[];
}

export const PICKER_SECTION_LABELS: Record<PickerSectionId, string> = {
  goto: "Go to",
  note: "Note",
  folder: "Folder",
  create: "Create",
  recent: "Recent",
  favorites: "Favorites",
};

export function pickerItems(sections: PickerSection[]): PickerItem[] {
  return sections.flatMap((section) => section.items);
}

export function buildPickerSections(input: {
  query: string;
  notes: NoteMeta[];
  folders: string[];
  collection?: PickerCollection | null;
}): PickerSection[] {
  const trimmed = input.query.trim();
  const bang = trimmed.startsWith("!");
  if (input.collection && !trimmed) {
    return section(input.collection, [
      { type: "back", key: "back" },
      ...input.notes.map((note) => ({ type: "note" as const, key: note.id, note })),
    ]);
  }
  if (bang) {
    const needle = trimmed.slice(1).trimStart().toLowerCase();
    const hits = input.folders.filter((folder) => !needle || folder.toLowerCase().includes(needle));
    return section("folder", hits.map(folderItem));
  }
  if (!trimmed) {
    return [
      ...section("goto", GOTO_ITEMS),
      ...section("folder", [{ type: "search-folder", key: "search-folder" }]),
    ];
  }

  const folderQuery = trimmed.endsWith("/") ? trimmed.slice(0, -1).toLowerCase() : "";
  const notes = folderQuery ? notesInFolder(input.notes, folderQuery) : input.notes;
  const draft = folderQuery ? null : parseCreateQuery(input.query);
  const canCreate =
    !!draft &&
    !input.notes.some(
      (note) =>
        (note.folder ?? "").toLowerCase() === draft.folder.toLowerCase() &&
        note.title.toLowerCase() === draft.title.toLowerCase(),
    );
  const needle = trimmed.toLowerCase();

  return [
    ...section(
      "goto",
      folderQuery ? [] : GOTO_ITEMS.filter((item) => gotoLabel(item).toLowerCase().startsWith(needle)),
    ),
    ...section(
      "note",
      notes.map((note) => ({ type: "note" as const, key: note.id, note })),
    ),
    ...section("create", draft && canCreate ? [createItem(draft)] : []),
  ];
}

function gotoLabel(item: PickerItem): string {
  return item.type === "jump" || item.type === "collection" ? item.label : "";
}

function section(id: PickerSectionId, items: PickerItem[]): PickerSection[] {
  return items.length ? [{ id, label: PICKER_SECTION_LABELS[id], items }] : [];
}

function folderItem(path: string): PickerItem {
  return { type: "folder", key: path, path };
}

function createItem(draft: { title: string; folder: string }): PickerItem {
  return {
    type: "create",
    key: "create",
    draft,
    label: draft.folder ? `${draft.folder}/${draft.title}` : draft.title,
  };
}

function notesInFolder(notes: NoteMeta[], prefix: string): NoteMeta[] {
  return notes.filter((note) => {
    const folder = (note.folder ?? "").toLowerCase();
    return folder === prefix || folder.startsWith(`${prefix}/`);
  });
}
