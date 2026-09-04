<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { api, ApiError, type ContextEvent, type Note, type NoteContext, type NoteMeta } from "../api";
import Backlinks from "./Backlinks.vue";
import AssetPicker from "./AssetPicker.vue";
import DeleteNoteDialog from "./DeleteNoteDialog.vue";
import Editor, { type RemoteCaret } from "./Editor.vue";
import HistoryPanel from "./HistoryPanel.vue";
import Preview from "./Preview.vue";
import { clearDraft, loadDraft, saveDraft } from "../lib/drafts";
import { threeWay } from "../lib/merge";
import { clearQueue, enqueue, loadQueue, newTmpId } from "../lib/context-queue";
import {
  contextLine,
  currentFix,
  lineRange,
  setLastWeather,
  setWhereHook,
  splitParagraphs,
  stamp,
  startGeoWatch,
} from "../lib/context";
import { excerptAround } from "../lib/excerpt";
import { live, type Live, type LiveEvent } from "../live";
import { pendingExcerpt, setParkContext, showParkCapture } from "../parked";
import { extractHashtags, pendingTagReveal } from "../lib/tags";
import { rememberTitle, setPinned } from "../workspace";

const props = withDefaults(
  defineProps<{
    noteId: string;
    toggle: () => void;
    client?: Live;
    focused?: boolean;
  }>(),
  { focused: true },
);
const client = computed(() => props.client ?? live);
const emit = defineEmits<{
  index: [];
}>();

const router = useRouter();
const title = ref("");
const folder = ref("");
const draftTitle = ref("");
const draftFolder = ref("");
const editingMeta = ref(false);
const content = ref("");
const tags = computed(() => extractHashtags(content.value));
const preview = ref(false);
const status = ref("");
const links = ref<NoteMeta[]>([]);
const remotes = ref<RemoteCaret[]>([]);
const isFavorite = ref(false);
const editor = ref<{
  excerpt: () => string;
  revealExcerpt: (quote: string) => boolean;
  revealRange: (from: number, to: number) => boolean;
  revealTag: (from: number, to: number) => boolean;
  currentOrdinal: () => number;
   lineCoords: (ordinal: number) => { top: number; bottom: number; left: number } | null;
   insertMarkdown: (markdown: string) => void;
} | null>(null);
const showContext = ref(false);
try {
  showContext.value = localStorage.getItem("mnote:show-context") === "1";
} catch {
  /* ignore */
}
const noteContext = ref<NoteContext>({ blocks: [], events: [] });
const selectedOrdinal = ref<number | null>(null);
const contextPopEl = ref<HTMLElement | null>(null);
const contextPos = ref({ top: 0, left: 0 });
let flushTimer: number | undefined;
const history = ref<{ show: () => void } | null>(null);
const actionsOpen = ref(false);
const actionsEl = ref<HTMLElement | null>(null);
const deleteOpen = ref(false);
const deleteBusy = ref(false);
const assetPickerOpen = ref(false);
const deleteError = ref("");
let replacing = false;
const parkShortcut = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? "⌘↵" : "Ctrl+↵";
let saveTimer: number | undefined;
let loadedId = "";
let base = "";
let rev = 0;
let applyingRemote = false;
let stopLive: (() => void) | undefined;

async function load() {
  const id = props.noteId;
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
    rememberTitle(note.id, note.title);
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
  client.value.connect();
  client.value.open(id, content.value);
  links.value = await api.backlinks(id).catch(() => []);
  isFavorite.value = await api
    .favorites()
    .then((notes) => notes.some((note) => note.id === id))
    .catch(() => false);
  setPinned(id, isFavorite.value);
  const quote = pendingExcerpt.value;
  if (quote) {
    pendingExcerpt.value = null;
    queueMicrotask(() => editor.value?.revealExcerpt(quote));
  }
  applyTagReveal();
  selectedOrdinal.value = null;
  noteContext.value = await api.noteContext(id).catch(() => ({ blocks: [], events: [] }));
  void flushContext();
}

function applyRemote(next: string) {
  applyingRemote = true;
  content.value = next;
  queueMicrotask(() => {
    applyingRemote = false;
  });
}

function onLive(event: LiveEvent) {
  const id = loadedId || props.noteId;
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
      client.value.push(id, event.content, merged.content);
    } else {
      base = event.content;
      clearDraft(id);
    }
    if (merged.conflict) status.value = "Conflict — keep both, then save";
    remotes.value = [];
    return;
  }
  if (event.type === "change" && event.path === id && event.client_id !== client.value.id) {
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
      client.value.push(id, event.content, merged.content);
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
  if (event.type === "cursor" && event.client_id !== client.value.id) {
    remotes.value = [
      ...remotes.value.filter((r) => r.id !== event.client_id),
      { id: event.client_id, from: event.from, to: event.to },
    ];
    return;
  }
  if (event.type === "peers") {
    remotes.value = event.peers
      .filter((peer) => peer.client_id !== client.value.id)
      .map((peer) => ({ id: peer.client_id, from: peer.from, to: peer.to }));
    return;
  }
  if (event.type === "gone") {
    remotes.value = remotes.value.filter((r) => r.id !== event.client_id);
  }
  if (event.type === "index" && event.note.id === id && !editingMeta.value) {
    title.value = event.note.title;
    folder.value = event.note.folder ?? "";
    rememberTitle(event.note.id, event.note.title);
  }
  if (event.type === "deleted" && event.id === id) {
    if (deleteBusy.value) return;
    markGone();
  }
}

function markGone() {
  if (loadedId) clearDraft(loadedId);
  loadedId = "";
  title.value = "";
  folder.value = "";
  content.value = "";
  links.value = [];
  remotes.value = [];
  deleteOpen.value = false;
  status.value = "Note not found";
}

function onLiveChange(change: { from: number; to: number; insert: string; content: string }) {
  const id = loadedId || props.noteId;
  if (!id) return;
  saveDraft(id, base, change.content);
  if (client.value.connected) {
    client.value.change(id, rev, change.content, change.from, change.to, change.insert);
    rev += 1;
  } else {
    status.value = "Offline — draft saved";
  }
}

async function save() {
  const id = loadedId || props.noteId;
  if (!id) return;
  status.value = "Saving…";
  try {
    await api.putNote(id, content.value);
    base = content.value;
    clearDraft(id);
    status.value = "Saved";
    links.value = await api.backlinks(id).catch(() => []);
    emit("index");
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
  const id = loadedId || props.noteId;
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
    rememberTitle(note.id, note.title);
    editingMeta.value = false;
    status.value = "Saved";
    emit("index");
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
  const id = loadedId || props.noteId;
  if (!id) return;
  try {
    if (isFavorite.value) await api.unfavorite(id);
    else await api.favorite(id);
    isFavorite.value = !isFavorite.value;
    setPinned(id, isFavorite.value);
  } catch {
    status.value = "Could not update favorite";
  }
}

const contextOrdinals = computed(() =>
  noteContext.value.blocks
    .filter((block) => block.ordinal != null && noteContext.value.events.some((ev) => ev.block_id === block.id))
    .map((block) => block.ordinal as number),
);

const selectedEvents = computed(() => {
  if (selectedOrdinal.value == null) return [];
  const block = noteContext.value.blocks.find((b) => b.ordinal === selectedOrdinal.value);
  if (!block) return [];
  return noteContext.value.events.filter((ev) => ev.block_id === block.id);
});

function toggleContext() {
  showContext.value = !showContext.value;
  try {
    localStorage.setItem("mnote:show-context", showContext.value ? "1" : "0");
  } catch {
    /* ignore */
  }
  if (!showContext.value) closeContextPop();
}

function queueContext(ordinal: number, source: "auto" | "where") {
  const id = loadedId || props.noteId;
  if (!id) return;
  const text = splitParagraphs(content.value)[ordinal] ?? "";
  if (!text.trim()) return;
  enqueue(id, { ...stamp("editor"), tmp_id: newTmpId(), ordinal, source });
  scheduleFlush();
}

function scheduleFlush() {
  window.clearTimeout(flushTimer);
  flushTimer = window.setTimeout(() => {
    void flushContext();
  }, 400);
}

async function flushContext() {
  const id = loadedId || props.noteId;
  if (!id) return;
  const events = loadQueue(id);
  if (!events.length) return;
  try {
    noteContext.value = await api.postNoteContext(id, {
      paragraphs: splitParagraphs(content.value),
      events,
    });
    clearQueue(id);
    const fix = currentFix();
    if (fix) {
      const weather = await api.weather(fix.lat, fix.lon).catch(() => null);
      if (weather) setLastWeather(weather);
    }
  } catch {
    /* keep queue */
  }
}

function closeContextPop() {
  selectedOrdinal.value = null;
}

function placeContextPop(ordinal: number) {
  const coords = editor.value?.lineCoords(ordinal);
  if (!coords) return;
  const pad = 8;
  const gap = 6;
  contextPos.value = { top: coords.bottom + gap, left: coords.left };
  void nextTick(() => {
    const box = contextPopEl.value?.getBoundingClientRect();
    const height = box?.height ?? 0;
    const width = box?.width ?? 240;
    let top = coords.bottom + gap;
    if (height && top + height + pad > window.innerHeight) {
      top = Math.max(pad, coords.top - height - gap);
    }
    const left = Math.min(Math.max(pad, coords.left), window.innerWidth - width - pad);
    contextPos.value = { top, left };
  });
}

function onSelectParagraph(ordinal: number) {
  if (!showContext.value) return;
  if (selectedOrdinal.value === ordinal) {
    closeContextPop();
    return;
  }
  const block = noteContext.value.blocks.find((b) => b.ordinal === ordinal);
  const events = block ? noteContext.value.events.filter((ev) => ev.block_id === block.id) : [];
  if (!events.length) {
    closeContextPop();
    return;
  }
  selectedOrdinal.value = ordinal;
  placeContextPop(ordinal);
}

function revealContextEvent(event: ContextEvent) {
  const block = noteContext.value.blocks.find((b) => b.id === event.block_id);
  if (block?.ordinal == null) return;
  const range = lineRange(content.value, block.ordinal);
  if (range) editor.value?.revealRange(range.from, range.to);
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

function showDelete() {
  if (!loadedId) return;
  deleteError.value = "";
  deleteOpen.value = true;
}

function closeDelete() {
  if (deleteBusy.value) return;
  deleteOpen.value = false;
  deleteError.value = "";
}

async function confirmDelete() {
  const id = loadedId || props.noteId;
  if (!id || deleteBusy.value) return;
  deleteBusy.value = true;
  deleteError.value = "";
  try {
    await api.deleteNote(id);
    clearDraft(id);
    loadedId = "";
    deleteOpen.value = false;
    emit("index");
    await router.push("/today");
  } catch {
    deleteError.value = "Could not delete";
  } finally {
    deleteBusy.value = false;
  }
}

function runAction(action: () => void) {
  closeActions();
  action();
}

function onDocClick(event: MouseEvent) {
  const target = event.target;
  if (actionsOpen.value && actionsEl.value && !actionsEl.value.contains(target as Node)) {
    closeActions();
  }
  if (selectedOrdinal.value == null || !(target instanceof Element)) return;
  if (target.closest("[data-testid='context-pop']") || target.closest(".cm-editor")) return;
  closeContextPop();
}

function onKey(event: KeyboardEvent) {
  if (event.key === "Escape" && selectedOrdinal.value != null) {
    event.preventDefault();
    closeContextPop();
    return;
  }
  if ((event.metaKey || event.ctrlKey) && event.key === "s") {
    event.preventDefault();
    window.clearTimeout(saveTimer);
    void save();
  }
}

function insertAsset(markdown: string) {
  editor.value?.insertMarkdown(markdown);
  assetPickerOpen.value = false;
  actionsOpen.value = false;
}

function openAssetPicker() {
  actionsOpen.value = false;
  assetPickerOpen.value = true;
}

function openImageManager() {
  actionsOpen.value = false;
  void router.push("/images");
}

client.value.connect();
stopLive = client.value.on(onLive);

function applyTagReveal() {
  const span = pendingTagReveal.value;
  const id = loadedId || props.noteId;
  if (!span || span.id !== id) return;
  pendingTagReveal.value = null;
  queueMicrotask(() => editor.value?.revealTag(span.from, span.to));
}

watch(
  () => props.noteId,
  () => {
    void load();
  },
  { immediate: true },
);

watch(pendingTagReveal, () => applyTagReveal());

watch(content, () => {
  if (!loadedId || applyingRemote) return;
  saveDraft(loadedId, base, content.value);
  if (client.value.connected) {
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
  client.value.connect();
  startGeoWatch();
  document.addEventListener("click", onDocClick);
  window.addEventListener("visibilitychange", onFlushNow);
  window.addEventListener("online", onFlushNow);
});

watch(
  () => props.focused,
  (on) => {
    if (!on) return;
    setWhereHook(() => {
      const ordinal = editor.value?.currentOrdinal() ?? 0;
      queueContext(ordinal, "where");
    });
    setParkContext(() => {
      if (!loadedId) return null;
      return {
        source_id: loadedId,
        source_title: title.value,
        source_folder: folder.value || undefined,
        excerpt: editor.value?.excerpt() || excerptAround(content.value, 0, 0) || undefined,
      };
    });
  },
  { immediate: true },
);

function onFlushNow() {
  void flushContext();
}

onBeforeUnmount(() => {
  stopLive?.();
  if (props.focused) {
    setParkContext(null);
    setWhereHook(null);
  }
  window.clearTimeout(flushTimer);
  void flushContext();
  document.removeEventListener("click", onDocClick);
  window.removeEventListener("visibilitychange", onFlushNow);
  window.removeEventListener("online", onFlushNow);
});
</script>

<template>
  <div class="note-pane" @keydown="onKey">
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
          <p
            class="muted note-folder"
            :class="{ 'is-empty': !folder }"
            data-testid="note-folder"
            title="Move note"
            @click="beginMeta"
          >
            {{ folder }}
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
          <span class="actions-more-label">More</span>
          <svg class="actions-more-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <circle cx="3.5" cy="8" r="1.2" fill="currentColor" />
            <circle cx="8" cy="8" r="1.2" fill="currentColor" />
            <circle cx="12.5" cy="8" r="1.2" fill="currentColor" />
          </svg>
        </button>
        <div class="actions-menu">
           <button type="button" class="ghost" data-testid="park" @click="runAction(() => showParkCapture())">
             Park {{ parkShortcut }}
           </button>
           <button type="button" class="ghost" data-testid="insert-image" @click="openAssetPicker">
             Insert image
           </button>
           <button type="button" class="ghost" @click="openImageManager">Manage images</button>
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
          <button
            type="button"
            class="ghost"
            data-testid="context-toggle"
            :aria-pressed="showContext"
            @click="runAction(toggleContext)"
          >
            {{ showContext ? "Hide context" : "Context" }}
          </button>
          <button type="button" class="ghost" data-testid="delete-note-open" @click="runAction(showDelete)">
            Delete
          </button>
          <button type="button" data-testid="save" @click="runAction(() => void save())">Save</button>
        </div>
      </div>
    </header>
    <div v-if="tags.length" class="note-tags" data-testid="note-tags">
      <p class="muted note-tags-line">
        {{ tags.map((tag) => `#${tag}`).join(" ") }}
      </p>
    </div>
    <Preview v-if="preview" :source="content" />
    <Editor
      v-else
      ref="editor"
      v-model="content"
      :note-id="noteId"
      :title="title"
      :folder="folder"
      :remotes="remotes"
      :show-context="showContext"
      :context-ordinals="contextOrdinals"
      @live-change="onLiveChange"
      @cursor="client.cursor($event.from, $event.to)"
      @paragraph-commit="queueContext($event.ordinal, 'auto')"
      @paragraph-leave="queueContext($event.ordinal, 'auto')"
      @select-paragraph="onSelectParagraph"
    />
    <Teleport to="body">
      <div
        v-if="showContext && selectedEvents.length"
        ref="contextPopEl"
        class="context-pop"
        data-testid="context-pop"
        :style="{ top: `${contextPos.top}px`, left: `${contextPos.left}px` }"
      >
        <p v-for="event in selectedEvents" :key="event.id">{{ contextLine(event) }}</p>
      </div>
    </Teleport>
    <Backlinks :links="links" />
    <HistoryPanel
      v-if="noteId"
      ref="history"
      :note-id="noteId"
      :current="content"
      :events="noteContext.events"
      @restored="onRestored"
      @reveal="revealContextEvent"
    />
    <DeleteNoteDialog
      v-if="deleteOpen"
      :title="title"
      :links="links"
      :error="deleteError"
      :busy="deleteBusy"
      @cancel="closeDelete"
      @confirm="void confirmDelete()"
    />
    <AssetPicker v-if="assetPickerOpen" @close="assetPickerOpen = false" @insert="insertAsset" />
  </div>
</template>
