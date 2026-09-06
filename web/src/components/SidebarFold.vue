<script setup lang="ts">
defineProps<{ open: boolean }>();
</script>

<template>
  <div class="sidebar-fold" :class="{ 'is-open': open }">
    <div class="sidebar-fold-inner" :inert="!open">
      <slot />
    </div>
  </div>
</template>
