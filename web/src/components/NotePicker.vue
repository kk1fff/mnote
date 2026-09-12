<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api, ApiError, type NoteMeta, type SearchHit } from "../api";
import {
  buildPickerSections,
  pickerItems,
  type PickerCollection,
  type PickerItem,
} from "../lib/picker";
import { noteFolderLabel, noteIdFromRoute } from "../lib/paths";
import { formatTagQuery, parseTagQuery, pendingTagReveal, tagsFromNotes } from "../lib/tags";
import { beginPendingAdd, cancelPendingAdd, openInWorkspace, pendingAdd, type OpenMode } from "../workspace";

const emit = defineEmits<{ created: [] }>();
const router = useRouter();
const route = useRoute();
const query = ref("");
const creating = ref(false);
const searching = ref(false);
const createBusy = ref(false);
let returnFocus: HTMLElement | null = null;
const results = ref<NoteMeta[]>([]);
const folders = ref<string[]>([]);
const foldersReady = ref(false);
const tagIndex = ref<{ name: string; count: number }[]>([]);
const tagHits = ref<SearchHit[]>([]);
const collection = ref<PickerCollection | null>(null);
const open = ref(false);
const openMode = ref<OpenMode>("replace");
const error = ref("");
const selected = ref(0);
const input = ref<HTMLInputElement | null>(null);
const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const createShortcut = mac ? "⌘↵" : "Ctrl+↵";
let searchTimer: number | undefined;
let searchId = 0;

const trimmed = computed(() => query.value.trim());
const bang = computed(() => trimmed.value.startsWith("!"));
const tagQuery = computed(() => parseTagQuery(trimmed.value));
const hash = computed(() => !!tagQuery.value);
const currentNoteId = computed(() =>
  route.name === "note" || route.path.startsWith("/n/") ? noteIdFromRoute(route.params.id) : "",
);
const exactTag = computed(() => {
  const name = tagQuery.value?.needle;
  if (!name || !tagIndex.value.some((tag) => tag.name === name)) return null;
  return name;
});
const folderQuery = computed(() => (trimmed.value.endsWith("/") ? trimmed.value.slice(0, -1) : ""));
const sections = computed(() =>
  creating.value && !trimmed.value ? [] : buildPickerSections({
    query: query.value,
    notes: results.value,
    folders: folders.value,
    tags: tagIndex.value,
    tagHits: tagHits.value,
    collection: collection.value,
  }),
);
const items = computed(() => pickerItems(sections.value));
const createItem = computed(() => {
  const item = items.value.find((entry) => entry.type === "create");
  return item?.type === "create" ? item : undefined;
});
const canCreate = computed(() => !!createItem.value);
const maxIndex = computed(() => items.value.length - 1);
const itemOffset = computed(() => {
  const offsets = new Map<string, number>();
  items.value.forEach((item, index) => offsets.set(item.key, index));
  return offsets;
});

function show(mode: OpenMode = "replace", collectionKind?: PickerCollection, initialQuery?: string) {
  if (mode === "add") {
    if (!pendingAdd.value) beginPendingAdd();
  } else {
    cancelPendingAdd();
  }
  returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  creating.value = false;
  open.value = true;
  openMode.value = mode;
  query.value = initialQuery ?? "";
  results.value = [];
  folders.value = [];
  foldersReady.value = false;
  tagIndex.value = [];
  tagHits.value = [];
  collection.value = null;
  error.value = "";
  selected.value = 0;
  if (collectionKind) {
    void enterCollection(collectionKind);
    return;
  }
  if (parseTagQuery(initialQuery ?? "")) void syncTagQuery();
  void nextTick(() => input.value?.focus());
}

function showCreate() {
  show();
  creating.value = true;
}

function showTag(tag: string) {
  show("replace", undefined, `#${tag}`);
}

function close() {
  open.value = false;
  cancelPendingAdd();
  window.clearTimeout(searchTimer);
  searchId++;
  searching.value = false;
  void nextTick(() => returnFocus?.isConnected && returnFocus.focus());
}

function clampSelected() {
  selected.value = Math.min(Math.max(selected.value, 0), Math.max(maxIndex.value, 0));
  if (maxIndex.value < 0) selected.value = -1;
}

function indexOf(item: PickerItem): number {
  return itemOffset.value.get(item.key) ?? -1;
}

async function select(note: NoteMeta) {
  const href = openInWorkspace(note.id, note.title, openMode.value);
  close();
  await router.push(href);
}

async function selectHit(hit: Extract<PickerItem, { type: "tag-hit" }>) {
  if (hit.from != null && hit.to != null) {
    pendingTagReveal.value = { id: hit.id, from: hit.from, to: hit.to };
  }
  const href = openInWorkspace(hit.id, hit.title, openMode.value);
  close();
  await router.push(href);
}

async function jump(to: string) {
  close();
  await router.push(to);
}

async function create() {
  if (!createItem.value || createBusy.value || searching.value) return;
  createBusy.value = true;
  error.value = "";
  try {
    const note = await api.createNote(createItem.value.draft.title, createItem.value.draft.folder);
    emit("created");
    const href = openInWorkspace(note.id, note.title, openMode.value);
    close();
    await router.push(href);
  } catch (err) {
    error.value = err instanceof ApiError ? err.code : "Could not create note";
  } finally {
    createBusy.value = false;
  }
}

function folderPrefixes(folder: string): string[] {
  const parts = folder.split("/").filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) out.push(parts.slice(0, i + 1).join("/"));
  return out;
}

async function ensureFolders() {
  if (foldersReady.value) return;
  try {
    const notes = await api.listNotes();
    const found = new Set<string>();
    for (const note of notes) {
      for (const folder of folderPrefixes(note.folder ?? "")) found.add(folder);
    }
    folders.value = [...found].sort((a, b) => a.localeCompare(b));
  } catch {
    folders.value = [];
  }
  foldersReady.value = true;
}

async function ensureTags() {
  try {
    const notes = await api.listNotes();
    tagIndex.value = tagsFromNotes(notes);
    results.value = notes;
  } catch {
    tagIndex.value = [];
    results.value = [];
  }
}

async function syncTagQuery() {
  await ensureTags();
  const tq = tagQuery.value;
  if (!tq) {
    tagHits.value = [];
    return;
  }
  const noteId = tq.here ? currentNoteId.value : "";
  try {
    if (tq.here || tq.chain.length) {
      tagIndex.value = await api.tagsQuery(trimmed.value, noteId || undefined);
    }
    const name = tq.needle;
    if (!name || !tagIndex.value.some((tag) => tag.name === name)) {
      tagHits.value = [];
      return;
    }
    const hits = await api.search(trimmed.value, noteId ? { note_id: noteId } : {});
    tagHits.value = hits.filter((hit) => hit.kind !== "parked");
  } catch {
    tagHits.value = [];
  }
}

function leaveCollection() {
  collection.value = null;
  query.value = "";
  results.value = [];
  error.value = "";
  selected.value = 0;
  void nextTick(() => input.value?.focus());
}

async function enterCollection(kind: PickerCollection) {
  collection.value = kind;
  query.value = "";
  results.value = [];
  error.value = "";
  selected.value = 0;
  try {
    if (kind === "tags") await ensureTags();
    else results.value = kind === "recent" ? await api.recentNotes() : await api.favorites();
  } catch {
    error.value = "Could not load notes";
  }
  clampSelected();
  void nextTick(() => input.value?.focus());
}

function enterFolderMode() {
  query.value = "!";
  results.value = [];
  error.value = "";
  selected.value = 0;
  void nextTick(() => input.value?.focus());
}

function pickFolder(folder: string) {
  query.value = `${folder}/`;
  selected.value = 0;
  void nextTick(() => input.value?.focus());
}

function pickTag(name: string) {
  collection.value = null;
  const tq = tagQuery.value;
  query.value = tq && (tq.here || tq.chain.length) ? formatTagQuery(tq.here, tq.chain, name) : `#${name}`;
  selected.value = 0;
  void ensureTags();
  void nextTick(() => input.value?.focus());
}

function activate(item: PickerItem) {
  if (item.type === "note") void select(item.note);
  else if (item.type === "tag-hit") void selectHit(item);
  else if (item.type === "folder") pickFolder(item.path);
  else if (item.type === "tag") pickTag(item.name);
  else if (item.type === "search-folder") enterFolderMode();
  else if (item.type === "collection") void enterCollection(item.key);
  else if (item.type === "back") leaveCollection();
  else if (item.type === "jump") void jump(item.to);
  else void create();
}

function submit() {
  const item = items.value[selected.value];
  if (item) activate(item);
}

function onKey(event: KeyboardEvent) {
  if (event.key === "Tab") {
    const dialog = input.value?.closest('[role="dialog"]');
    const controls = [...(dialog?.querySelectorAll<HTMLElement>('input, button:not(:disabled)') ?? [])];
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    if (collection.value) {
      leaveCollection();
      return;
    }
    if (bang.value || hash.value) {
      query.value = "";
      selected.value = 0;
      return;
    }
    close();
    return;
  }
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    event.stopPropagation();
    void create();
    return;
  }
  if (event.key === "ArrowDown") {
    event.preventDefault();
    if (maxIndex.value >= 0) selected.value = Math.min(selected.value + 1, maxIndex.value);
    return;
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    selected.value = Math.max(selected.value - 1, 0);
  }
}

watch(query, () => {
  window.clearTimeout(searchTimer);
  const requestId = ++searchId;
  searching.value = false;
  error.value = "";
  if (bang.value) {
    collection.value = null;
    results.value = [];
    selected.value = 0;
    void ensureFolders();
    clampSelected();
    return;
  }
  if (hash.value) {
    collection.value = null;
    selected.value = 0;
    void syncTagQuery();
    clampSelected();
    return;
  }
  const q = trimmed.value;
  if (collection.value && q) {
    collection.value = null;
    results.value = [];
  }
  if (!q) {
    if (!collection.value) results.value = [];
    selected.value = 0;
    return;
  }
  results.value = [];
  searching.value = true;
  searchTimer = window.setTimeout(async () => {
    try {
      const notes = await api.titleSearch(q);
      if (requestId === searchId) {
        results.value = notes;
        selected.value = 0;
        clampSelected();
      }
    } catch {
      if (requestId === searchId) {
        error.value = "Could not search notes. Please try again.";
        results.value = [];
        selected.value = items.value.findIndex((item) => item.type === "create");
      }
    } finally {
      if (requestId === searchId) searching.value = false;
    }
  }, 120);
});

watch(items, () => {
  if (selected.value > maxIndex.value || selected.value < 0) clampSelected();
});

defineExpose({ show, showCreate, showTag, open });
</script>

<template>
  <div v-if="open" class="picker-scrim" @click.self="close">
    <section class="note-picker" data-testid="picker" role="dialog" aria-modal="true" aria-label="Open or create note" @keydown="onKey">
      <form class="picker-field" @submit.prevent="submit">
        <input
          ref="input"
          v-model="query"
          type="search"
          :placeholder="hash ? 'Search tags' : bang ? 'Search folders' : creating ? 'Name your new note' : 'Search or create a note'"
          data-testid="picker-input"
          aria-label="Search or create a note"
        />
        <button type="button" class="ghost picker-close" aria-label="Close picker" @click="close">Close</button>
      </form>
      <p v-if="error" class="error picker-message">{{ error }}</p>
      <div v-else class="picker-body" :aria-busy="searching">
        <p v-if="searching" class="muted picker-message" role="status">Searching notes…</p>
        <p v-else-if="trimmed && !bang && !hash && !folderQuery && !results.length" class="muted picker-message" role="status">No matching notes. Create one below.</p>
        <p v-if="creating && !trimmed" class="muted picker-message">Give your note a title. Use folder/title to organize it.</p>
        <section v-for="section in sections" :key="section.id" class="picker-section">
          <p class="picker-section-title">{{ section.label }}</p>
          <ul class="picker-results">
            <li v-for="item in section.items" :key="item.key">
              <button
                v-if="item.type === 'note'"
                type="button"
                :class="{ active: selected === indexOf(item) }"
                @click="select(item.note)"
              >
                <span>{{ item.note.title }}</span>
                <small v-if="noteFolderLabel(item.note)">{{ noteFolderLabel(item.note) }}</small>
              </button>
              <button
                v-else-if="item.type === 'folder'"
                type="button"
                :class="{ active: selected === indexOf(item) }"
                @click="pickFolder(item.path)"
              >
                <span>{{ item.path }}</span>
              </button>
              <button
                v-else-if="item.type === 'tag'"
                type="button"
                :data-testid="`picker-tag-${item.name}`"
                :class="{ active: selected === indexOf(item) }"
                @click="pickTag(item.name)"
              >
                <span>#{{ item.name }}</span>
                <small>{{ item.count }}</small>
              </button>
              <button
                v-else-if="item.type === 'tag-hit'"
                type="button"
                data-testid="picker-tag-hit"
                :class="{ active: selected === indexOf(item) }"
                @click="selectHit(item)"
              >
                <span>{{ item.title }}</span>
                <small>L{{ item.line ?? "?" }} {{ item.snippet }}</small>
              </button>
              <button
                v-else-if="item.type === 'search-folder'"
                type="button"
                data-testid="picker-search-folder"
                :class="{ active: selected === indexOf(item) }"
                @click="enterFolderMode"
              >
                <span>Search folder</span>
              </button>
              <button
                v-else-if="item.type === 'jump'"
                type="button"
                :class="{ active: selected === indexOf(item) }"
                @click="jump(item.to)"
              >
                <span>{{ item.label }}</span>
              </button>
              <button
                v-else-if="item.type === 'collection'"
                type="button"
                :data-testid="`picker-${item.key}`"
                :class="{ active: selected === indexOf(item) }"
                @click="enterCollection(item.key)"
              >
                <span>{{ item.label }}</span>
              </button>
              <button
                v-else-if="item.type === 'back'"
                type="button"
                data-testid="picker-back"
                :class="{ active: selected === indexOf(item) }"
                @click="leaveCollection"
              >
                <span>← Go to</span>
              </button>
              <button
                v-else
                type="button"
                data-testid="picker-create"
                class="picker-create"
                :disabled="createBusy || searching"
                :class="{ active: selected === indexOf(item) }"
                @click="create"
              >
                <span>Create “{{ item.label }}”</span>
                <small>{{ createShortcut }}</small>
              </button>
            </li>
          </ul>
        </section>
        <p v-if="bang && !sections.length" class="muted picker-message">No folders yet</p>
        <p v-else-if="exactTag && !tagHits.length" class="muted picker-message">No lines with this tag</p>
        <p v-else-if="hash && !sections.length" class="muted picker-message">No tags yet</p>
        <p v-else-if="collection && !results.length && collection !== 'tags'" class="muted picker-message">No notes yet</p>
        <p v-else-if="collection === 'tags' && tagIndex.length === 0" class="muted picker-message">No tags yet</p>
        <p
          v-else-if="!bang && folderQuery && trimmed && !sections.some((section) => section.id === 'note')"
          class="muted picker-message"
        >
          No notes in {{ trimmed }}
        </p>
        <p v-else-if="!trimmed && !collection && !creating" class="muted picker-message">Type a title to search or create a note</p>
        <p v-if="!bang && folderQuery && !canCreate" class="muted picker-message">
          Type a name to create in {{ trimmed }}
        </p>
      </div>
      <footer class="picker-footer"><span>↑ ↓ Navigate · ↵ Open · Esc {{ collection || bang || hash ? "Back" : "Close" }}</span><span v-if="canCreate">{{ createShortcut }} create</span></footer>
    </section>
  </div>
</template>
