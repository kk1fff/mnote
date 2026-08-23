<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { api, ApiError, type NoteMeta } from "../api";
import { buildPickerSections, pickerItems, type PickerItem } from "../lib/picker";
import { noteFolderLabel, noteHref } from "../lib/paths";

const emit = defineEmits<{ created: [] }>();
const router = useRouter();
const query = ref("");
const results = ref<NoteMeta[]>([]);
const folders = ref<string[]>([]);
const foldersReady = ref(false);
const open = ref(false);
const error = ref("");
const selected = ref(0);
const input = ref<HTMLInputElement | null>(null);
const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const createShortcut = mac ? "⌘↵" : "Ctrl+↵";
let searchTimer: number | undefined;
let searchId = 0;

const trimmed = computed(() => query.value.trim());
const bang = computed(() => trimmed.value.startsWith("!"));
const folderQuery = computed(() => (trimmed.value.endsWith("/") ? trimmed.value.slice(0, -1) : ""));
const sections = computed(() =>
  buildPickerSections({ query: query.value, notes: results.value, folders: folders.value }),
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

function show() {
  open.value = true;
  query.value = "";
  results.value = [];
  folders.value = [];
  foldersReady.value = false;
  error.value = "";
  selected.value = 0;
  void nextTick(() => input.value?.focus());
}

function close() {
  open.value = false;
}

function clampSelected() {
  selected.value = Math.min(Math.max(selected.value, 0), Math.max(maxIndex.value, 0));
  if (maxIndex.value < 0) selected.value = -1;
}

function indexOf(item: PickerItem): number {
  return itemOffset.value.get(item.key) ?? -1;
}

async function select(note: NoteMeta) {
  close();
  await router.push(noteHref(note.id));
}

async function create() {
  if (!createItem.value) return;
  error.value = "";
  try {
    const note = await api.createNote(createItem.value.draft.title, createItem.value.draft.folder);
    emit("created");
    close();
    await router.push(noteHref(note.id));
  } catch (err) {
    error.value = err instanceof ApiError ? err.code : "Could not create note";
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

function activate(item: PickerItem) {
  if (item.type === "note") void select(item.note);
  else if (item.type === "folder") pickFolder(item.path);
  else if (item.type === "search-folder") enterFolderMode();
  else void create();
}

function submit() {
  const item = items.value[selected.value];
  if (item) activate(item);
}

function onKey(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault();
    if (bang.value) {
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
  error.value = "";
  if (bang.value) {
    results.value = [];
    selected.value = 0;
    void ensureFolders();
    clampSelected();
    return;
  }
  const q = trimmed.value;
  if (!q) {
    results.value = [];
    selected.value = 0;
    return;
  }
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
        results.value = [];
        selected.value = items.value.findIndex((item) => item.type === "create");
      }
    }
  }, 120);
});

watch(items, () => {
  if (selected.value > maxIndex.value || selected.value < 0) clampSelected();
});

defineExpose({ show, open });
</script>

<template>
  <div v-if="open" class="picker-scrim" @click.self="close">
    <section class="note-picker" data-testid="picker" role="dialog" aria-modal="true" aria-label="Open or create note">
      <form class="picker-field" @submit.prevent="submit">
        <div class="picker-mirror" aria-hidden="true">
          <span class="picker-spacer">{{ query }}</span>
          <span v-if="canCreate" class="picker-hint"> {{ createShortcut }} create</span>
        </div>
        <input
          ref="input"
          v-model="query"
          type="search"
          :placeholder="bang ? 'Search folders' : 'Search or create a note'"
          data-testid="picker-input"
          aria-label="Search or create a note"
          @keydown="onKey"
        />
      </form>
      <p v-if="error" class="error picker-message">{{ error }}</p>
      <div v-else class="picker-body">
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
                v-else-if="item.type === 'search-folder'"
                type="button"
                data-testid="picker-search-folder"
                :class="{ active: selected === indexOf(item) }"
                @click="enterFolderMode"
              >
                <span>Search folder</span>
              </button>
              <button
                v-else
                type="button"
                data-testid="picker-create"
                class="picker-create"
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
        <p
          v-else-if="!bang && folderQuery && trimmed && !sections.some((section) => section.id === 'note')"
          class="muted picker-message"
        >
          No notes in {{ trimmed }}
        </p>
        <p v-else-if="!trimmed" class="muted picker-message">Type a title to search or create a note</p>
        <p v-if="!bang && folderQuery && !canCreate" class="muted picker-message">
          Type a name to create in {{ trimmed }}
        </p>
      </div>
    </section>
  </div>
</template>
