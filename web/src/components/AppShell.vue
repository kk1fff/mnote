<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { refreshParked, registerParkedList, showParkCapture } from "../parked";
import type { PickerCollection } from "../lib/picker";
import { registerTagOpen } from "../lib/tags";
import { sidebarPrefs, toggleSidebarSection } from "../sidebar";
import { registerPicker, type OpenMode } from "../workspace";
import NavIcon from "./NavIcon.vue";
import NotePicker from "./NotePicker.vue";
import ParkCapture from "./ParkCapture.vue";
import ParkedPanel from "./ParkedPanel.vue";
import Sidebar from "./Sidebar.vue";

const sidebar = ref<{ load: () => Promise<void> } | null>(null);
const picker = ref<{
  show: (mode?: OpenMode, collection?: PickerCollection) => void;
  showTag: (tag: string) => void;
  showCreate: () => void;
  open: boolean;
} | null>(null);
const parked = ref<{ show: (id?: number) => void } | null>(null);
const open = ref(false);
const route = useRoute();

watch(
  () => route.fullPath,
  () => {
    open.value = false;
  },
);

defineExpose({
  load: () => sidebar.value?.load(),
});

function onKey(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && ((event.shiftKey && event.key.toLowerCase() === "o") || (!event.shiftKey && event.key.toLowerCase() === "k"))) {
    event.preventDefault();
    picker.value?.show();
  }
  if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "i") {
    event.preventDefault();
    showParkCapture();
  }
  if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key === "Enter") {
    if (picker.value?.open) return;
    event.preventDefault();
    showParkCapture();
  }
}

onMounted(() => {
  window.addEventListener("keydown", onKey);
  registerPicker((mode) => picker.value?.show(mode));
  registerTagOpen((tag) => picker.value?.showTag(tag));
  registerParkedList((id) => parked.value?.show(id));
  void refreshParked().catch(() => undefined);
});
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKey);
  registerPicker(null);
  registerTagOpen(null);
  registerParkedList(null);
});
</script>

<template>
  <div class="app-shell" :class="{ 'nav-open': open, 'sidebar-folded': sidebarPrefs.sidebarFolded }">
    <button class="nav-scrim" type="button" aria-label="Close menu" @click="open = false" />
    <Sidebar
      ref="sidebar"
      @open-picker="(collection) => picker?.show('replace', collection)"
      @open-parked="parked?.show()"
      @create-note="picker?.showCreate()"
      @close="open = false"
    />
    <button
      type="button"
      class="sidebar-fold-btn"
      data-testid="sidebar-fold"
      :title="sidebarPrefs.sidebarFolded ? 'Open sidebar' : 'Fold sidebar'"
      :aria-label="sidebarPrefs.sidebarFolded ? 'Open sidebar' : 'Fold sidebar'"
      :aria-expanded="!sidebarPrefs.sidebarFolded"
      @click="toggleSidebarSection('sidebarFolded')"
    >
      <NavIcon :name="sidebarPrefs.sidebarFolded ? 'panelOpen' : 'panelClose'" />
    </button>
    <slot :toggle="() => (open = !open)" />
    <NotePicker ref="picker" @created="sidebar?.load()" />
    <ParkCapture />
    <ParkedPanel ref="parked" @created="sidebar?.load()" />
  </div>
</template>
