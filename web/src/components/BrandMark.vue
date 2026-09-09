<script setup lang="ts">
withDefaults(defineProps<{ size?: number }>(), { size: 28 });
</script>

<template>
  <svg
    class="brand-mark"
    :width="size"
    :height="size"
    viewBox="0 0 32 32"
    aria-hidden="true"
  >
    <rect width="32" height="32" rx="8" fill="var(--accent)" />
    <path
      d="M10 8h8.2L22 12.2V24H10V8z"
      fill="none"
      stroke="var(--accent-fg)"
      stroke-width="1.7"
      stroke-linejoin="round"
    />
    <path
      d="M18 8v4.2H22"
      fill="none"
      stroke="var(--accent-fg)"
      stroke-width="1.7"
      stroke-linejoin="round"
    />
  </svg>
</template>
