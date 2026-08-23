<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { api, ApiError, type Note, type NoteMeta } from "../api";
import AppShell from "../components/AppShell.vue";
import Backlinks from "../components/Backlinks.vue";
import Editor, { type RemoteCaret } from "../components/Editor.vue";
import HistoryPanel from "../components/HistoryPanel.vue";
import Preview from "../components/Preview.vue";
import { clearDraft, loadDraft, saveDraft } from "../lib/drafts";
import { threeWay } from "../lib/merge";
import { excerptAround } from "../lib/excerpt";
import { noteIdFromRoute } from "../lib/paths";
import { live, type LiveEvent } from "../live";
import { pendingExcerpt, setParkContext, showParkCapture } from "../parked";

const route = useRoute();
const noteId = computed(() => noteIdFromRoute(route.params.id));
const title = ref("");
const folder = ref("");
const draftTitle = ref("");
const draftFolder = ref("");
const editingMeta = ref(false);
const content = ref("");
const preview = ref(false);
const status = ref("");
const links = ref<NoteMeta[]>([]);
const remotes = ref<RemoteCaret[]>([]);
const isFavorite = ref(false);
const shell = ref<{ load: () => Promise<void> } | null>(null);
const editor = ref<{ excerpt: () => string; revealExcerpt: (quote: string) => boolean } | null>(null);
const history = ref<{ show: () => void } | null>(null);
const actionsOpen = ref(false);
const actionsEl = ref<HTMLElement | null>(null);
let replacing = false;
const parkShortcut = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? "⌘↵" : "Ctrl+↵";
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
    folder.value = "";
    editingMeta.value = false;
    try {
      const note = await api.getNote(id);
      applyRemote(note.content);
      loadedId = note.id;
      title.value = note.title;
      folder.value = note.folder ?? "";
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
  const quote = pendingExcerpt.value;
  if (quote) {
    pendingExcerpt.value = null;
    queueMicrotask(() => editor.value?.revealExcerpt(quote));
  }
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
    if (replacing) {
      applyRemote(event.content);
      base = event.content;
      clearDraft(id);
      return;
    }
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
  if (event.type === "index" && event.note.id === id && !editingMeta.value) {
    title.value = event.note.title;
    folder.value = event.note.folder ?? "";
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

function beginMeta() {
  if (!loadedId) return;
  draftTitle.value = title.value;
  draftFolder.value = folder.value;
  editingMeta.value = true;
}

function cancelMeta() {
  editingMeta.value = false;
}

async function saveMeta() {
  const id = loadedId || noteId.value;
  if (!id || !editingMeta.value) return;
  const nextTitle = draftTitle.value.trim();
  const nextFolder = draftFolder.value.trim().replace(/^\/+|\/+$/g, "");
  if (nextTitle === title.value && nextFolder === folder.value) {
    editingMeta.value = false;
    return;
  }
  try {
    const note = await api.patchNote(id, { title: nextTitle, folder: nextFolder });
    title.value = note.title;
    folder.value = note.folder ?? "";
    editingMeta.value = false;
    status.value = "Saved";
    await shell.value?.load();
  } catch (err) {
    status.value = err instanceof ApiError ? err.code : "Could not rename";
  }
}

async function onRestored(note: Note) {
  replacing = true;
  applyRemote(note.content);
  base = note.content;
  clearDraft(note.id);
  status.value = "Restored";
  queueMicrotask(() => {
    replacing = false;
  });
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

function closeActions() {
  actionsOpen.value = false;
}

function runAction(action: () => void) {
  closeActions();
  action();
}

function onDocClick(event: MouseEvent) {
  if (!actionsOpen.value || !actionsEl.value) return;
  if (!actionsEl.value.contains(event.target as Node)) closeActions();
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
  document.addEventListener("click", onDocClick);
  setParkContext(() => {
    if (!loadedId) return null;
    return {
      source_id: loadedId,
      source_title: title.value,
      source_folder: folder.value || undefined,
      excerpt: editor.value?.excerpt() || excerptAround(content.value, 0, 0) || undefined,
    };
  });
});

onBeforeUnmount(() => {
  stopLive?.();
  setParkContext(null);
  document.removeEventListener("click", onDocClick);
});
</script>

<template>
  <AppShell ref="shell" v-slot="{ toggle }" @keydown="onKey">
    <main class="main">
      <header class="bar">
        <button type="button" class="nav-toggle ghost" @click="toggle">Menu</button>
        <div class="note-heading">
          <form v-if="editingMeta" class="note-meta-form" @submit.prevent="saveMeta">
            <input
              v-model="draftTitle"
              class="title-input"
              data-testid="note-title-input"
              aria-label="Note title"
              @keydown.enter.prevent="saveMeta"
              @keydown.escape.prevent="cancelMeta"
            />
            <input
              v-model="draftFolder"
              class="folder-input"
              data-testid="note-folder-input"
              aria-label="Note folder"
              placeholder="Folder"
              @keydown.enter.prevent="saveMeta"
              @keydown.escape.prevent="cancelMeta"
            />
          </form>
          <template v-else>
            <h1 data-testid="note-title" title="Rename note" @click="beginMeta">{{ title || "Note" }}</h1>
            <p class="muted note-folder" data-testid="note-folder" title="Move note" @click="beginMeta">
              {{ folder || "No folder" }}
            </p>
          </template>
        </div>
        <div ref="actionsEl" class="actions" :class="{ open: actionsOpen }">
          <span class="muted note-status" data-testid="note-status">{{ status }}</span>
          <button
            type="button"
            class="actions-more"
            aria-label="More actions"
            :aria-expanded="actionsOpen"
            @click="actionsOpen = !actionsOpen"
          >
            More
          </button>
          <div class="actions-menu">
            <button type="button" class="ghost" data-testid="park" @click="runAction(() => showParkCapture())">
              Park {{ parkShortcut }}
            </button>
            <button
              type="button"
              class="ghost"
              data-testid="favorite"
              :aria-pressed="isFavorite"
              @click="runAction(() => void toggleFavorite())"
            >
              {{ isFavorite ? "Unfavorite" : "Favorite" }}
            </button>
            <button type="button" class="ghost" data-testid="preview-toggle" @click="runAction(() => (preview = !preview))">
              {{ preview ? "Source" : "Preview" }}
            </button>
            <button type="button" class="ghost" data-testid="history" @click="runAction(() => history?.show())">
              History
            </button>
            <button type="button" data-testid="save" @click="runAction(() => void save())">Save</button>
          </div>
        </div>
      </header>
      <Preview v-if="preview" :source="content" />
      <Editor
        v-else
        ref="editor"
        v-model="content"
        :remotes="remotes"
        @live-change="onLiveChange"
        @cursor="live.cursor($event.from, $event.to)"
      />
      <Backlinks :links="links" />
      <HistoryPanel
        v-if="noteId"
        ref="history"
        :note-id="noteId"
        :current="content"
        @restored="onRestored"
      />
    </main>
  </AppShell>
</template>
