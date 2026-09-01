<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { refreshParked, showParkCapture } from "../parked";
import type { PickerCollection } from "../lib/picker";
import { registerPicker, type OpenMode } from "../workspace";
import NotePicker from "./NotePicker.vue";
import ParkCapture from "./ParkCapture.vue";
import ParkedPanel from "./ParkedPanel.vue";
import Sidebar from "./Sidebar.vue";

const sidebar = ref<{ load: () => Promise<void> } | null>(null);
const picker = ref<{
  show: (mode?: OpenMode, collection?: PickerCollection) => void;
  open: boolean;
} | null>(null);
const parked = ref<{ show: () => void } | null>(null);
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
  if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "o") {
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
  void refreshParked().catch(() => undefined);
});
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKey);
  registerPicker(null);
});
</script>

<template>
  <div class="app-shell" :class="{ 'nav-open': open }">
    <button class="nav-scrim" type="button" aria-label="Close menu" @click="open = false" />
    <Sidebar
      ref="sidebar"
      @open-picker="(collection) => picker?.show('replace', collection)"
      @open-parked="parked?.show()"
      @close="open = false"
    />
    <slot :toggle="() => (open = !open)" />
    <NotePicker ref="picker" @created="sidebar?.load()" />
    <ParkCapture />
    <ParkedPanel ref="parked" @created="sidebar?.load()" />
  </div>
</template>
