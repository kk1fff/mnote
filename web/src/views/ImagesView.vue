<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { api, type Asset, type NoteMeta } from "../api";
import AppShell from "../components/AppShell.vue";

const assets = ref<Asset[]>([]);
const group = ref("");
const query = ref("");
const error = ref("");
const selected = ref<Asset | null>(null);
const links = ref<NoteMeta[]>([]);

const groups = computed(() => [...new Set(assets.value.map((asset) => asset.group).filter(Boolean))].sort());
const visible = computed(() => {
  const needle = query.value.trim().toLowerCase();
  return assets.value.filter((asset) =>
    (!group.value || asset.group === group.value) && (!needle || asset.original_name.toLowerCase().includes(needle)),
  );
});

async function load() {
  error.value = "";
  try { assets.value = await api.listAssets(); } catch { error.value = "Could not load images"; }
}

async function select(asset: Asset) {
  selected.value = asset;
  links.value = await api.assetBacklinks(asset.id).catch(() => []);
}

onMounted(() => void load());
</script>

<template>
  <AppShell v-slot="{ toggle }">
    <main class="main images-view">
      <header class="bar">
        <button type="button" class="nav-toggle ghost" @click="toggle">Menu</button>
        <h1>Images</h1>
      </header>
      <div class="images-toolbar">
        <label>Group<select v-model="group"><option value="">All images</option><option v-for="item in groups" :key="item" :value="item">{{ item }}</option></select></label>
        <label>Search<input v-model="query" placeholder="Image name" /></label>
      </div>
      <p v-if="error" class="error results">{{ error }}</p>
      <p v-else-if="!visible.length" class="muted results">No images found.</p>
      <div v-else class="images-grid">
        <button v-for="asset in visible" :key="asset.id" type="button" class="image-library-card" @click="select(asset)">
          <img :src="asset.url" :alt="asset.original_name" loading="lazy" />
          <strong>{{ asset.original_name }}</strong>
          <span class="muted">{{ asset.group || "Ungrouped" }} · {{ asset.width }} × {{ asset.height }}</span>
          <code>mnote-asset:{{ asset.id }}</code>
        </button>
      </div>
      <section v-if="selected" class="image-detail" aria-live="polite">
        <div><h2>{{ selected.original_name }}</h2><p class="muted">{{ selected.group || "Ungrouped" }} · {{ selected.mime }} · {{ selected.width }} × {{ selected.height }}</p><code>mnote-asset:{{ selected.id }}</code></div>
        <div><h3>Used in</h3><p v-if="!links.length" class="muted">Not embedded in any current note.</p><ul v-else><li v-for="note in links" :key="note.id"><RouterLink :to="`/n/${note.id}`">{{ note.title }}</RouterLink><span class="muted"> {{ note.folder }}</span></li></ul></div>
      </section>
    </main>
  </AppShell>
</template>
