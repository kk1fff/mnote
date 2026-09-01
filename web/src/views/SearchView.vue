<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api, type SearchHit } from "../api";
import AppShell from "../components/AppShell.vue";
import { currentFix, startGeoWatch } from "../lib/context";
import { openInWorkspace } from "../workspace";
import { showParkedList } from "../parked";

const route = useRoute();
const router = useRouter();
const hits = ref<SearchHit[]>([]);
const error = ref("");
const weather = ref("");

const extra = computed(() => {
  const out: Record<string, string> = {};
  for (const key of ["from", "to", "weather", "near", "radius_m"] as const) {
    const value = String(route.query[key] ?? "").trim();
    if (value) out[key] = value;
  }
  return out;
});

async function run() {
  const q = String(route.query.q ?? "").trim();
  weather.value = String(route.query.weather ?? "");
  error.value = "";
  hits.value = [];
  if (!q && !Object.keys(extra.value).length) return;
  try {
    hits.value = await api.search(q, extra.value);
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Search failed";
  }
}

function applyWeather() {
  void router.replace({
    query: { ...route.query, weather: weather.value.trim() || undefined },
  });
}

function openHit(hit: SearchHit) {
  if (hit.kind === "parked" && hit.parked_id != null) {
    showParkedList(hit.parked_id);
    return;
  }
  void router.push(openInWorkspace(hit.id, hit.title));
}

function nearMe() {
  startGeoWatch();
  const fix = currentFix();
  if (!fix) {
    error.value = "Location unavailable";
    return;
  }
  void router.replace({
    query: { ...route.query, near: `${fix.lat},${fix.lon}` },
  });
}

onMounted(() => {
  startGeoWatch();
  void run();
});
watch(() => route.query, run, { deep: true });
</script>

<template>
  <AppShell v-slot="{ toggle }">
    <main class="main">
      <header class="bar">
        <button type="button" class="nav-toggle ghost" @click="toggle">Menu</button>
        <h1>Search</h1>
      </header>
      <form class="context-filters" @submit.prevent="applyWeather">
        <input
          v-model="weather"
          data-testid="search-weather"
          placeholder="Weather"
          aria-label="Weather"
        />
        <button type="submit" class="ghost">Filter</button>
        <button type="button" class="ghost" data-testid="search-near" @click="nearMe">Near me</button>
      </form>
      <p v-if="error" class="error results">{{ error }}</p>
      <p v-else-if="!hits.length" class="muted results">No matches</p>
      <ul class="results">
        <li v-for="hit in hits" :key="hit.id">
          <a href="#" data-testid="search-hit" @click.prevent="openHit(hit)">{{ hit.title }}</a>
          <p>{{ hit.context || hit.snippet }}</p>
        </li>
      </ul>
    </main>
  </AppShell>
</template>
