<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { api, type SearchHit } from "../api";
import AppShell from "../components/AppShell.vue";
import { noteHref } from "../lib/paths";

const route = useRoute();
const hits = ref<SearchHit[]>([]);
const error = ref("");

async function run() {
  const q = String(route.query.q ?? "").trim();
  error.value = "";
  hits.value = [];
  if (!q) return;
  try {
    hits.value = await api.search(q);
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Search failed";
  }
}

onMounted(run);
watch(() => route.query.q, run);
</script>

<template>
  <AppShell v-slot="{ toggle }">
    <main class="main">
      <header class="bar">
        <button type="button" class="nav-toggle" @click="toggle">Menu</button>
        <h1>Search</h1>
      </header>
      <p v-if="error" class="error results">{{ error }}</p>
      <p v-else-if="!hits.length" class="muted results">No matches</p>
      <ul class="results">
        <li v-for="hit in hits" :key="hit.id">
          <RouterLink :to="noteHref(hit.id)">{{ hit.title }}</RouterLink>
          <p>{{ hit.snippet }}</p>
        </li>
      </ul>
    </main>
  </AppShell>
</template>
