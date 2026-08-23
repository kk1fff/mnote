<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import type { NoteMeta } from "../api";
import AppShell from "../components/AppShell.vue";
import { noteHref } from "../lib/paths";

const props = defineProps<{
  title: string;
  load: () => Promise<NoteMeta[]>;
}>();

const notes = ref<NoteMeta[]>([]);
const error = ref("");

async function refresh() {
  error.value = "";
  try {
    notes.value = await props.load();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Could not load notes";
  }
}

onMounted(refresh);
watch(() => props.load, refresh);
</script>

<template>
  <AppShell v-slot="{ toggle }">
    <main class="main">
      <header class="bar">
        <button type="button" class="nav-toggle ghost" @click="toggle">Menu</button>
        <h1>{{ title }}</h1>
      </header>
      <p v-if="error" class="error results">{{ error }}</p>
      <p v-else-if="!notes.length" class="muted results">No notes yet</p>
      <ul v-else class="results">
        <li v-for="note in notes" :key="note.id">
          <RouterLink :to="noteHref(note.id)">{{ note.title }}</RouterLink>
        </li>
      </ul>
    </main>
  </AppShell>
</template>
