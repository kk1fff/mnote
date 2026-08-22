<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { api, type SearchHit } from "../api";
import Sidebar from "../components/Sidebar.vue";
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
  <div class="app-shell">
    <Sidebar />
    <main class="main">
      <header class="bar">
        <h1>Search</h1>
      </header>
      <p v-if="error" class="error">{{ error }}</p>
      <p v-else-if="!hits.length" class="muted">No matches</p>
      <ul class="results">
        <li v-for="hit in hits" :key="hit.path">
          <RouterLink :to="noteHref(hit.path)">{{ hit.title }}</RouterLink>
          <p>{{ hit.snippet }}</p>
        </li>
      </ul>
    </main>
  </div>
</template>
