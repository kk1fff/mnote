<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import NotePicker from "./NotePicker.vue";
import Sidebar from "./Sidebar.vue";

const sidebar = ref<{ load: () => Promise<void> } | null>(null);
const picker = ref<{ show: () => void } | null>(null);
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
}

onMounted(() => window.addEventListener("keydown", onKey));
onBeforeUnmount(() => window.removeEventListener("keydown", onKey));
</script>

<template>
  <div class="app-shell" :class="{ 'nav-open': open }">
    <button class="nav-scrim" type="button" aria-label="Close menu" @click="open = false" />
    <Sidebar ref="sidebar" @open-picker="picker?.show()" />
    <slot :toggle="() => (open = !open)" />
    <NotePicker ref="picker" @created="sidebar?.load()" />
  </div>
</template>
