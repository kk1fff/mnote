<script setup lang="ts">
import { ref, watch } from "vue";
import { useRoute } from "vue-router";
import Sidebar from "./Sidebar.vue";

const sidebar = ref<{ load: () => Promise<void> } | null>(null);
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
</script>

<template>
  <div class="app-shell" :class="{ 'nav-open': open }">
    <button class="nav-scrim" type="button" aria-label="Close menu" @click="open = false" />
    <Sidebar ref="sidebar" />
    <slot :toggle="() => (open = !open)" />
  </div>
</template>
