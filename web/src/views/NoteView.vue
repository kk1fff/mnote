<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { api, ApiError, type NoteMeta } from "../api";
import AppShell from "../components/AppShell.vue";
import Backlinks from "../components/Backlinks.vue";
import Editor, { type RemoteCaret } from "../components/Editor.vue";
import Preview from "../components/Preview.vue";
import { clearDraft, loadDraft, saveDraft } from "../lib/drafts";
import { threeWay } from "../lib/merge";
import { noteIdFromRoute } from "../lib/paths";
import { live, type LiveEvent } from "../live";

const route = useRoute();
const noteId = computed(() => noteIdFromRoute(route.params.id));
const title = ref("");
const content = ref("");
const preview = ref(false);
const status = ref("");
const links = ref<NoteMeta[]>([]);
const remotes = ref<RemoteCaret[]>([]);
const isFavorite = ref(false);
const shell = ref<{ load: () => Promise<void> } | null>(null);
let saveTimer: number | undefined;
let loadedId = "";
let base = "";
let rev = 0;
let applyingRemote = false;
let stopLive: (() => void) | undefined;

async function load() {
  const id = noteId.value;
  if (!id) {
    status.value = "Note not found";
    return;
  }
  status.value = "Loading…";
  remotes.value = [];
  title.value = "";
  try {
    const note = await api.getNote(id);
    applyRemote(note.content);
    loadedId = note.id;
    title.value = note.title;
    base = note.content;
    status.value = "Saved";
  } catch (err) {
    status.value = err instanceof ApiError && err.status === 404 ? "Note not found" : "Failed to load";
    return;
  }
  const draft = loadDraft(id);
  if (draft && draft.local !== content.value) {
    const merged = threeWay(draft.base, draft.local, content.value);
    applyRemote(merged.content);
    status.value = merged.conflict ? "Conflict — keep both, then save" : "Restored local draft";
  }
  live.connect();
  live.open(id, content.value);
  links.value = await api.backlinks(id).catch(() => []);
  isFavorite.value = await api
    .favorites()
    .then((notes) => notes.some((note) => note.id === id))
    .catch(() => false);
}

function applyRemote(next: string) {
  applyingRemote = true;
  content.value = next;
  queueMicrotask(() => {
    applyingRemote = false;
  });
}

function onLive(event: LiveEvent) {
  const id = loadedId || noteId.value;
  if (event.type === "status") {
    if (!event.connected && loadedId) {
      saveDraft(loadedId, base, content.value);
      status.value = "Offline — draft saved";
    }
    return;
  }
  if (event.type === "opened" && event.path === id) {
    rev = event.rev;
    const merged = threeWay(base, content.value, event.content);
    applyRemote(merged.content);
    if (merged.content !== event.content) {
      live.push(id, event.content, merged.content);
    } else {
      base = event.content;
      clearDraft(id);
    }
    if (merged.conflict) status.value = "Conflict — keep both, then save";
    remotes.value = [];
    return;
  }
  if (event.type === "change" && event.path === id && event.client_id !== live.id) {
    rev = event.rev;
    applyRemote(event.content);
    base = event.content;
    clearDraft(id);
    return;
  }
  if (event.type === "resync" && event.path === id) {
    rev = event.rev;
    const merged = threeWay(base, content.value, event.content);
    applyRemote(merged.content);
    if (merged.content !== event.content) {
      live.push(id, event.content, merged.content);
    } else {
      base = event.content;
      if (!event.conflict) clearDraft(id);
    }
    if (event.conflict || merged.conflict) {
      remotes.value = [];
      status.value = "Conflict — keep both, then save";
    }
    return;
  }
  if (event.type === "cursor" && event.client_id !== live.id) {
    remotes.value = [
      ...remotes.value.filter((r) => r.id !== event.client_id),
      { id: event.client_id, from: event.from, to: event.to },
    ];
    return;
  }
  if (event.type === "peers") {
    remotes.value = event.peers
      .filter((peer) => peer.client_id !== live.id)
      .map((peer) => ({ id: peer.client_id, from: peer.from, to: peer.to }));
    return;
  }
  if (event.type === "gone") {
    remotes.value = remotes.value.filter((r) => r.id !== event.client_id);
  }
}

function onLiveChange(change: { from: number; to: number; insert: string; content: string }) {
  const id = loadedId || noteId.value;
  if (!id) return;
  saveDraft(id, base, change.content);
  if (live.connected) {
    live.change(id, rev, change.content, change.from, change.to, change.insert);
    rev += 1;
  } else {
    status.value = "Offline — draft saved";
  }
}

async function save() {
  const id = loadedId || noteId.value;
  if (!id) return;
  status.value = "Saving…";
  try {
    await api.putNote(id, content.value);
    base = content.value;
    clearDraft(id);
    status.value = "Saved";
    links.value = await api.backlinks(id).catch(() => []);
    await shell.value?.load();
  } catch {
    saveDraft(id, base, content.value);
    status.value = "Save failed — draft kept";
  }
}

async function toggleFavorite() {
  const id = loadedId || noteId.value;
  if (!id) return;
  try {
    if (isFavorite.value) await api.unfavorite(id);
    else await api.favorite(id);
    isFavorite.value = !isFavorite.value;
  } catch {
    status.value = "Could not update favorite";
  }
}

function queueSave() {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    void save();
  }, 800);
}

function onKey(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key === "s") {
    event.preventDefault();
    window.clearTimeout(saveTimer);
    void save();
  }
}

live.connect();
stopLive = live.on(onLive);

watch(noteId, () => {
  void load();
}, { immediate: true });

watch(content, () => {
  if (!loadedId || applyingRemote) return;
  saveDraft(loadedId, base, content.value);
  if (live.connected) {
    status.value = "Editing";
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      status.value = "Saved";
    }, 800);
    return;
  }
  status.value = "Offline — draft saved";
  queueSave();
});

onMounted(() => {
  live.connect();
});

onBeforeUnmount(() => {
  stopLive?.();
});
</script>

<template>
  <AppShell ref="shell" v-slot="{ toggle }" @keydown="onKey">
    <main class="main">
      <header class="bar">
        <button type="button" class="nav-toggle" @click="toggle">Menu</button>
        <h1>{{ title || "Note" }}</h1>
        <div class="actions">
          <span class="muted">{{ status }}</span>
          <button type="button" :aria-pressed="isFavorite" @click="toggleFavorite">
            {{ isFavorite ? "Unfavorite" : "Favorite" }}
          </button>
          <button type="button" data-testid="preview-toggle" @click="preview = !preview">
            {{ preview ? "Source" : "Preview" }}
          </button>
          <button type="button" data-testid="save" @click="save">Save</button>
        </div>
      </header>
      <Preview v-if="preview" :source="content" />
      <Editor
        v-else
        v-model="content"
        :remotes="remotes"
        @live-change="onLiveChange"
        @cursor="live.cursor($event.from, $event.to)"
      />
      <Backlinks :links="links" />
    </main>
  </AppShell>
</template>
