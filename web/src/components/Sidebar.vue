<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api, ApiError, type NoteMeta } from "../api";
import { decodeNotePath, normalizeNotePath, noteHref, todayPath } from "../lib/paths";
import { noteTree } from "../lib/tree";
import { currentUser, logout } from "../session";
import NoteTree from "./NoteTree.vue";

const notes = ref<NoteMeta[]>([]);
const q = ref("");
const newPath = ref("");
const createError = ref("");
const collapsed = ref(new Set<string>());
const route = useRoute();
const router = useRouter();

const tree = computed(() => noteTree(notes.value));
const activePath = computed(() =>
  route.path.startsWith("/n/") ? decodeNotePath(route.path.slice(3)) : "",
);

async function load() {
  notes.value = await api.listNotes();
}

function search() {
  const query = q.value.trim();
  if (!query) return;
  void router.push({ path: "/search", query: { q: query } });
}

async function create() {
  const path = normalizeNotePath(newPath.value);
  createError.value = "";
  if (!path) {
    createError.value = "Use a path like ideas/one";
    return;
  }
  try {
    await api.createNote(path);
  } catch (err) {
    if (!(err instanceof ApiError && err.status === 409)) {
      createError.value = err instanceof ApiError ? err.code : "Could not create note";
      return;
    }
  }
  newPath.value = "";
  await load();
  await router.push(noteHref(path));
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

defineExpose({ load });
</script>

<template>
  <aside class="sidebar">
    <div class="brand">
      <strong>mnote</strong>
      <span>{{ currentUser?.username }}</span>
    </div>
    <form class="search" @submit.prevent="search">
      <input v-model="q" type="search" placeholder="Search" />
    </form>
    <form class="new-note" @submit.prevent="create">
      <input v-model="newPath" placeholder="New note (ideas/one)" aria-label="New note path" />
    </form>
    <p v-if="createError" class="error">{{ createError }}</p>
    <nav>
      <RouterLink :to="`/n/${todayPath()}`">Today</RouterLink>
      <RouterLink to="/password">Password</RouterLink>
      <button type="button" class="linkish" @click="signOut">Log out</button>
    </nav>
    <NoteTree :nodes="tree" :active-path="activePath" :collapsed="collapsed" @toggle="toggle" />
  </aside>
</template>
