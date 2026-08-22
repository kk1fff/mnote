<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api, type NoteMeta } from "../api";
import { noteHref, todayPath } from "../lib/paths";
import { currentUser, logout } from "../session";

const notes = ref<NoteMeta[]>([]);
const q = ref("");
const route = useRoute();
const router = useRouter();

async function load() {
  notes.value = await api.listNotes();
}

function search() {
  const query = q.value.trim();
  if (!query) return;
  void router.push({ path: "/search", query: { q: query } });
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
    <nav>
      <RouterLink :to="`/n/${todayPath()}`">Today</RouterLink>
      <RouterLink to="/password">Password</RouterLink>
      <button type="button" class="linkish" @click="signOut">Log out</button>
    </nav>
    <ul>
      <li v-for="note in notes" :key="note.path">
        <RouterLink
          :to="noteHref(note.path)"
          :class="{ active: route.path === noteHref(note.path) }"
        >
          {{ note.title }}
        </RouterLink>
      </li>
    </ul>
  </aside>
</template>
