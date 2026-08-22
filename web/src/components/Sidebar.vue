<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api, type NoteMeta } from "../api";
import { noteIdFromRoute } from "../lib/paths";
import { noteTree } from "../lib/tree";
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

onMounted(() => {
  void load();
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
