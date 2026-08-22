<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api, type NoteMeta } from "../api";
import { noteIdFromRoute } from "../lib/paths";
import { noteTree } from "../lib/tree";
import { live, type LiveEvent } from "../live";
import { currentUser, logout } from "../session";
import NoteTree from "./NoteTree.vue";

const notes = ref<NoteMeta[]>([]);
const q = ref("");
const collapsed = ref(new Set<string>());
const route = useRoute();
const router = useRouter();

const tree = computed(() => noteTree(notes.value));
const activeId = computed(() =>
  route.name === "note" || route.path.startsWith("/n/") ? noteIdFromRoute(route.params.id) : "",
);

function upsert(note: NoteMeta) {
  const i = notes.value.findIndex((n) => n.id === note.id);
  if (i >= 0) {
    const cur = notes.value[i];
    if (cur.title === note.title && (cur.folder ?? "") === (note.folder ?? "")) return;
    const next = notes.value.slice();
    next[i] = note;
    notes.value = next;
    return;
  }
  notes.value = [...notes.value, note];
}

function onLive(event: LiveEvent) {
  if (event.type === "index") upsert(event.note);
  if (event.type === "status" && event.connected) void load();
}

async function load() {
  notes.value = await api.listNotes();
}

function search() {
  const query = q.value.trim();
  if (!query) return;
  void router.push({ path: "/search", query: { q: query } });
}

function toggle(path: string) {
  const next = new Set(collapsed.value);
  if (next.has(path)) next.delete(path);
  else next.add(path);
  collapsed.value = next;
}

async function signOut() {
  await logout();
  await router.push("/login");
}

live.connect();
const stopLive = live.on(onLive);

onMounted(() => {
  live.connect();
  void load();
});

onBeforeUnmount(() => {
  stopLive();
});

const emit = defineEmits<{ "open-picker": [] }>();

defineExpose({ load });
</script>

<template>
  <aside class="sidebar">
    <div class="brand">
      <strong>mnote</strong>
      <span>{{ currentUser?.username }}</span>
    </div>
    <form class="search" @submit.prevent="search">
      <input v-model="q" type="search" placeholder="Search notes" aria-label="Search notes" />
    </form>
    <button class="new-note-button" type="button" @click="emit('open-picker')">New note</button>
    <nav class="shortcuts" aria-label="Quick access">
      <RouterLink to="/today">Today</RouterLink>
      <RouterLink to="/recent">Recent</RouterLink>
      <RouterLink to="/favorites">Favorites</RouterLink>
    </nav>
    <div class="note-library">
      <p class="section-label">Notes</p>
      <div class="note-tree">
        <NoteTree :nodes="tree" :active-id="activeId" :collapsed="collapsed" @toggle="toggle" />
      </div>
    </div>
    <div class="sidebar-footer">
      <RouterLink to="/password">Account</RouterLink>
      <button type="button" class="linkish" @click="signOut">Sign out</button>
    </div>
  </aside>
</template>
