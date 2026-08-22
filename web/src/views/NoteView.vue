<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api, ApiError, type NoteMeta } from "../api";
import Backlinks from "../components/Backlinks.vue";
import Editor from "../components/Editor.vue";
import Preview from "../components/Preview.vue";
import Sidebar from "../components/Sidebar.vue";
import { isDailyPath, pathFromRouteParam } from "../lib/paths";

const route = useRoute();
const router = useRouter();
const path = computed(() => pathFromRouteParam(route.params.path));
const content = ref("");
const preview = ref(false);
const status = ref("");
const links = ref<NoteMeta[]>([]);
const sidebar = ref<{ load: () => Promise<void> } | null>(null);
let saveTimer: number | undefined;
let loadedPath = "";

async function load() {
  const p = path.value;
  if (!p) {
    await router.replace("/");
    return;
  }
  status.value = "Loading…";
  try {
    const note = isDailyPath(p) ? await api.daily(p) : await api.getNote(p);
    content.value = note.content;
    loadedPath = note.path;
    status.value = "Saved";
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      content.value = `# ${p}\n\n`;
      loadedPath = p;
      status.value = "New note";
    } else {
      status.value = "Failed to load";
      return;
    }
  }
  links.value = await api.backlinks(p).catch(() => []);
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
    status.value = "Saved";
    links.value = await api.backlinks(p).catch(() => []);
    await sidebar.value?.load();
  } catch {
    status.value = "Save failed";
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
  if (!loadedPath) return;
  status.value = "Editing";
  queueSave();
});
</script>

<template>
  <div class="app-shell" @keydown="onKey">
    <Sidebar ref="sidebar" />
    <main class="main">
      <header class="bar">
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
      <Editor v-else v-model="content" />
      <Backlinks :links="links" />
    </main>
  </div>
</template>
