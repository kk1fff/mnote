<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api, ApiError, type NoteMeta } from "../api";
import AppShell from "../components/AppShell.vue";
import Backlinks from "../components/Backlinks.vue";
import Editor, { type RemoteCaret } from "../components/Editor.vue";
import Preview from "../components/Preview.vue";
import { clearDraft, loadDraft, saveDraft } from "../lib/drafts";
import { threeWay } from "../lib/merge";
import { isDailyPath, pathFromRouteParam } from "../lib/paths";
import { live, type LiveEvent } from "../live";

const route = useRoute();
const router = useRouter();
const path = computed(() => pathFromRouteParam(route.params.path));
const content = ref("");
const preview = ref(false);
const status = ref("");
const links = ref<NoteMeta[]>([]);
const remotes = ref<RemoteCaret[]>([]);
const shell = ref<{ load: () => Promise<void> } | null>(null);
let saveTimer: number | undefined;
let loadedPath = "";
let base = "";
let rev = 0;
let applyingRemote = false;
let stopLive: (() => void) | undefined;

async function load() {
  const p = path.value;
  if (!p) {
    await router.replace("/");
    return;
  }
  status.value = "Loading…";
  remotes.value = [];
  try {
    const note = isDailyPath(p) ? await api.daily(p) : await api.getNote(p);
    applyRemote(note.content);
    loadedPath = note.path;
    base = note.content;
    status.value = "Saved";
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      applyRemote(`# ${p}\n\n`);
      loadedPath = p;
      base = content.value;
      status.value = "New note";
    } else {
      status.value = "Failed to load";
      return;
    }
  }
  const draft = loadDraft(p);
  if (draft && draft.local !== content.value) {
    const merged = threeWay(draft.base, draft.local, content.value);
    applyRemote(merged.content);
    status.value = merged.conflict ? "Conflict — keep both, then save" : "Restored local draft";
  }
  live.open(p, content.value);
  links.value = await api.backlinks(p).catch(() => []);
}

function applyRemote(next: string) {
  applyingRemote = true;
  content.value = next;
  queueMicrotask(() => {
    applyingRemote = false;
  });
}

function onLive(event: LiveEvent) {
  const p = loadedPath || path.value;
  if (event.type === "status") {
    if (!event.connected && loadedPath) {
      saveDraft(loadedPath, base, content.value);
      status.value = "Offline — draft saved";
    }
    return;
  }
  if (event.type === "opened" && event.path === p) {
    rev = event.rev;
    const merged = threeWay(base, content.value, event.content);
    applyRemote(merged.content);
    if (merged.content !== event.content) {
      live.push(p, event.content, merged.content);
    } else {
      base = event.content;
      clearDraft(p);
    }
    if (merged.conflict) status.value = "Conflict — keep both, then save";
    remotes.value = [];
    return;
  }
  if (event.type === "change" && event.path === p && event.client_id !== live.id) {
    rev = event.rev;
    applyRemote(event.content);
    base = event.content;
    clearDraft(p);
    return;
  }
  if (event.type === "resync" && event.path === p) {
    rev = event.rev;
    const merged = threeWay(base, content.value, event.content);
    applyRemote(merged.content);
    if (merged.content !== event.content) {
      live.push(p, event.content, merged.content);
    } else {
      base = event.content;
      if (!event.conflict) clearDraft(p);
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
  const p = loadedPath || path.value;
  if (!p) return;
  saveDraft(p, base, change.content);
  if (live.connected) {
    live.change(p, rev, change.content, change.from, change.to, change.insert);
    rev += 1;
  } else {
    status.value = "Offline — draft saved";
  }
}

async function save() {
  const p = loadedPath || path.value;
  if (!p) return;
  status.value = "Saving…";
  try {
    if (isDailyPath(p)) {
      await api.putDaily(p, content.value);
    } else {
      await api.putNote(p, content.value);
    }
    base = content.value;
    clearDraft(p);
    status.value = "Saved";
    links.value = await api.backlinks(p).catch(() => []);
    await shell.value?.load();
  } catch {
    saveDraft(p, base, content.value);
    status.value = "Save failed — draft kept";
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

watch(path, () => {
  void load();
}, { immediate: true });

watch(content, () => {
  if (!loadedPath || applyingRemote) return;
  status.value = live.connected ? "Editing" : "Offline — draft saved";
  saveDraft(loadedPath, base, content.value);
  if (!live.connected) queueSave();
});

onMounted(() => {
  live.connect();
  stopLive = live.on(onLive);
});

onBeforeUnmount(() => {
  stopLive?.();
  live.disconnect();
});
</script>

<template>
  <AppShell ref="shell" v-slot="{ toggle }" @keydown="onKey">
    <main class="main">
      <header class="bar">
        <button type="button" class="nav-toggle" @click="toggle">Menu</button>
        <h1>{{ path }}</h1>
        <div class="actions">
          <span class="muted">{{ status }}</span>
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
