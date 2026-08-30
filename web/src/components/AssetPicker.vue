<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { api, type Asset } from "../api";
import { isAllowedImage } from "../lib/images";

const emit = defineEmits<{ close: []; insert: [markdown: string] }>();
const assets = ref<Asset[]>([]);
const selected = ref<Asset | null>(null);
const tab = ref<"library" | "upload">("library");
const group = ref("");
const alt = ref("");
const busy = ref(false);
const error = ref("");

const groups = computed(() => [...new Set(assets.value.map((asset) => asset.group).filter(Boolean))].sort());

async function load() {
  error.value = "";
  try {
    assets.value = await api.listAssets();
  } catch {
    error.value = "Could not load images";
  }
}

function choose(asset: Asset) {
  selected.value = asset;
  alt.value = asset.original_name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
}

async function upload(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file || !isAllowedImage(file)) {
    error.value = "Choose a PNG, JPEG, GIF, or WebP image";
    return;
  }
  busy.value = true;
  error.value = "";
  try {
    const asset = await api.uploadAsset(file, group.value);
    assets.value = [asset, ...assets.value];
    choose(asset);
    tab.value = "library";
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Could not upload image";
  } finally {
    busy.value = false;
  }
}

function insert() {
  if (!selected.value) return;
  emit("insert", `![${alt.value.trim()}](mnote-asset:${selected.value.id})`);
}

onMounted(() => void load());
</script>

<template>
  <Teleport to="body">
    <div class="sheet-scrim" @click.self="emit('close')">
      <section class="sheet asset-picker" data-testid="asset-picker" role="dialog" aria-modal="true" aria-label="Insert image">
        <header class="sheet-bar">
          <div>
            <h2>Insert image</h2>
            <p class="muted">Upload a new image or choose one from your vault.</p>
          </div>
          <button type="button" class="ghost" aria-label="Close" @click="emit('close')">Close</button>
        </header>
        <div class="asset-picker-tabs" role="tablist">
          <button type="button" :class="{ active: tab === 'library' }" @click="tab = 'library'">Your images</button>
          <button type="button" :class="{ active: tab === 'upload' }" @click="tab = 'upload'">Upload</button>
        </div>
        <p v-if="error" class="error">{{ error }}</p>
        <div v-if="tab === 'library'" class="asset-picker-body">
          <label class="asset-group-filter">Group
            <select v-model="group">
              <option value="">All images</option>
              <option v-for="item in groups" :key="item" :value="item">{{ item }}</option>
            </select>
          </label>
          <div v-if="assets.filter((asset) => !group || asset.group === group).length" class="asset-grid">
            <button
              v-for="asset in assets.filter((item) => !group || item.group === group)"
              :key="asset.id"
              type="button"
              class="asset-card"
              :class="{ selected: selected?.id === asset.id }"
              @click="choose(asset)"
            >
              <img :src="asset.url" :alt="asset.original_name" loading="lazy" />
              <span>{{ asset.original_name }}</span>
            </button>
          </div>
          <p v-else class="muted asset-empty">No images in this group yet.</p>
        </div>
        <div v-else class="asset-upload">
          <label>Group (optional)<input v-model="group" placeholder="Trips / 2026" /></label>
          <label class="asset-upload-drop">Choose an image<input type="file" accept="image/png,image/jpeg,image/gif,image/webp" :disabled="busy" @change="upload" /></label>
          <p class="muted">PNG, JPEG, GIF, or WebP. Maximum 10 MB.</p>
        </div>
        <footer class="asset-picker-footer">
          <label v-if="selected">Alt text<input v-model="alt" placeholder="Describe this image" /></label>
          <span v-else class="muted">Select an image to insert.</span>
          <div><button type="button" class="ghost" @click="emit('close')">Cancel</button><button type="button" :disabled="!selected || busy" @click="insert">Insert image</button></div>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
