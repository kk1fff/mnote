<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { api, ApiError, type NoteMeta } from "../api";
import { normalizeNotePath, noteHref } from "../lib/paths";

const emit = defineEmits<{ created: [] }>();
const router = useRouter();
const query = ref("");
const results = ref<NoteMeta[]>([]);
const open = ref(false);
const error = ref("");
const input = ref<HTMLInputElement | null>(null);
let searchTimer: number | undefined;
let searchId = 0;

function show() {
  open.value = true;
  query.value = "";
  results.value = [];
  error.value = "";
  void nextTick(() => input.value?.focus());
}

function close() {
  open.value = false;
}

async function select(note: NoteMeta) {
  close();
  await router.push(noteHref(note.path));
}

async function create() {
  const path = normalizeNotePath(query.value);
  if (!path) {
    error.value = "Enter a note name or path";
    return;
  }
  error.value = "";
  try {
    await api.createNote(path);
    emit("created");
    close();
    await router.push(noteHref(path));
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) {
      await router.push(noteHref(path));
      close();
      return;
    }
    error.value = err instanceof ApiError ? err.code : "Could not create note";
  }
}

function submit() {
  if (results.value.length) void select(results.value[0]);
  else void create();
}

watch(query, () => {
  window.clearTimeout(searchTimer);
  const requestId = ++searchId;
  const q = query.value.trim();
  if (!q) {
    results.value = [];
    return;
  }
  searchTimer = window.setTimeout(async () => {
    try {
      const notes = await api.titleSearch(q);
      if (requestId === searchId) results.value = notes;
    } catch {
      if (requestId === searchId) results.value = [];
    }
  }, 120);
});

defineExpose({ show });
</script>

<template>
  <div v-if="open" class="picker-scrim" @click.self="close">
    <section class="note-picker" role="dialog" aria-modal="true" aria-label="Open or create note">
      <form @submit.prevent="submit">
        <input
          ref="input"
          v-model="query"
          type="search"
          placeholder="Search or create a note"
          aria-label="Search or create a note"
          @keydown.esc.prevent="close"
        />
      </form>
      <p v-if="error" class="error picker-message">{{ error }}</p>
      <ul v-else-if="results.length" class="picker-results">
        <li v-for="note in results" :key="note.path">
          <button type="button" @click="select(note)">
            <span>{{ note.title }}</span>
            <small>{{ note.path }}</small>
          </button>
        </li>
      </ul>
      <p v-else-if="query.trim()" class="picker-message">Create “{{ query.trim() }}”</p>
      <p v-else class="muted picker-message">Type a title or path to search or create a note</p>
    </section>
  </div>
</template>
