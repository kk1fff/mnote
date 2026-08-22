<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { api, ApiError, type NoteMeta } from "../api";
import { noteFolderLabel, noteHref, parseCreateQuery } from "../lib/paths";

const emit = defineEmits<{ created: [] }>();
const router = useRouter();
const query = ref("");
const results = ref<NoteMeta[]>([]);
const open = ref(false);
const error = ref("");
const selected = ref(0);
const input = ref<HTMLInputElement | null>(null);
const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const createShortcut = mac ? "⌘↵" : "Ctrl+↵";
let searchTimer: number | undefined;
let searchId = 0;

const trimmed = computed(() => query.value.trim());
const folderQuery = computed(() => (trimmed.value.endsWith("/") ? trimmed.value.slice(0, -1).toLowerCase() : ""));
const shown = computed(() => {
  if (!folderQuery.value) return results.value;
  const prefix = folderQuery.value;
  return results.value.filter((note) => {
    const folder = (note.folder ?? "").toLowerCase();
    return folder === prefix || folder.startsWith(`${prefix}/`);
  });
});
const createDraft = computed(() => (folderQuery.value ? null : parseCreateQuery(query.value)));
const canCreate = computed(() => {
  if (!createDraft.value) return false;
  const title = createDraft.value.title.toLowerCase();
  return !results.value.some((note) => note.title.toLowerCase() === title);
});
const createLabel = computed(() => {
  if (!createDraft.value) return trimmed.value;
  return createDraft.value.folder
    ? `${createDraft.value.folder}/${createDraft.value.title}`
    : createDraft.value.title;
});
const maxIndex = computed(() => {
  if (shown.value.length && canCreate.value) return shown.value.length;
  if (shown.value.length) return shown.value.length - 1;
  return canCreate.value ? 0 : -1;
});

function show() {
  open.value = true;
  query.value = "";
  results.value = [];
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

async function select(note: NoteMeta) {
  close();
  await router.push(noteHref(note.id));
}

async function create() {
  if (!canCreate.value || !createDraft.value) return;
  error.value = "";
  try {
    const note = await api.createNote(createDraft.value.title, createDraft.value.folder);
    emit("created");
    close();
    await router.push(noteHref(note.id));
  } catch (err) {
    error.value = err instanceof ApiError ? err.code : "Could not create note";
  }
}

function submit() {
  if (selected.value >= 0 && selected.value < shown.value.length) {
    void select(shown.value[selected.value]);
    return;
  }
  if (canCreate.value) void create();
}

function onKey(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault();
    close();
    return;
  }
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
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
  const q = trimmed.value;
  if (!q) {
    results.value = [];
    selected.value = -1;
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
        selected.value = canCreate.value ? 0 : -1;
      }
    }
  }, 120);
});

watch([shown, canCreate], () => {
  if (selected.value > maxIndex.value || selected.value < 0) clampSelected();
});

defineExpose({ show });
</script>

<template>
  <div v-if="open" class="picker-scrim" @click.self="close">
    <section class="note-picker" role="dialog" aria-modal="true" aria-label="Open or create note">
      <form class="picker-field" @submit.prevent="submit">
        <div class="picker-mirror" aria-hidden="true">
          <span class="picker-spacer">{{ query }}</span>
          <span v-if="canCreate" class="picker-hint"> {{ createShortcut }} create</span>
        </div>
        <input
          ref="input"
          v-model="query"
          type="search"
          placeholder="Search or create a note"
          aria-label="Search or create a note"
          @keydown="onKey"
        />
      </form>
      <p v-if="error" class="error picker-message">{{ error }}</p>
      <template v-else>
        <ul v-if="shown.length" class="picker-results">
          <li v-for="(note, index) in shown" :key="note.id">
            <button type="button" :class="{ active: selected === index }" @click="select(note)">
              <span>{{ note.title }}</span>
              <small v-if="noteFolderLabel(note)">{{ noteFolderLabel(note) }}</small>
            </button>
          </li>
        </ul>
        <p v-else-if="folderQuery && trimmed" class="muted picker-message">
          No notes in {{ trimmed }}
        </p>
        <p v-else-if="!trimmed" class="muted picker-message">
          Type a title to search or create a note
        </p>
        <button
          v-if="canCreate"
          type="button"
          class="picker-create"
          :class="{ active: selected === shown.length || !shown.length }"
          @click="create"
        >
          <span>Create “{{ createLabel }}”</span>
          <small>{{ createShortcut }}</small>
        </button>
        <p v-else-if="folderQuery" class="muted picker-message">Type a name to create in {{ trimmed }}</p>
      </template>
    </section>
  </div>
</template>
