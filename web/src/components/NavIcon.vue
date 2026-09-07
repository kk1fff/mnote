<script setup lang="ts">
export type IconName =
  | "search"
  | "plus"
  | "inbox"
  | "note"
  | "journal"
  | "image"
  | "star"
  | "tag"
  | "calendar"
  | "link"
  | "history"
  | "more"
  | "gear";

defineProps<{ name: IconName }>();
</script>

<template>
  <svg
    class="nav-icon"
    viewBox="0 0 16 16"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <template v-if="name === 'search'">
      <circle cx="7" cy="7" r="4.25" />
      <path d="m10.2 10.2 3.1 3.1" />
    </template>
    <template v-else-if="name === 'plus'">
      <path d="M8 3.25v9.5M3.25 8h9.5" />
    </template>
    <template v-else-if="name === 'inbox'">
      <path d="M2.5 9.25 4.1 4.75h7.8l1.6 4.5v3.5H2.5v-3.5z" />
      <path d="M2.5 9.25h3.05l.7 1.5h3.5l.7-1.5H13.5" />
    </template>
    <template v-else-if="name === 'note'">
      <path d="M4.25 2.75h5.1L12.75 6v7.25h-8.5V2.75z" />
      <path d="M9.25 2.75V6h2.85" />
    </template>
    <template v-else-if="name === 'journal' || name === 'calendar'">
      <path d="M3.25 5.25h9.5v8H3.25z" />
      <path d="M5.5 3.25v2.5M10.5 3.25v2.5M3.25 7.5h9.5" />
    </template>
    <template v-else-if="name === 'image'">
      <path d="M2.75 3.75h10.5v8.5H2.75z" />
      <circle cx="5.75" cy="6.5" r="1" />
      <path d="m2.75 10.5 2.6-2.4 2.1 1.9 2.15-2.7 3.65 3.2" />
    </template>
    <template v-else-if="name === 'star'">
      <path d="m8 2.6 1.45 2.95 3.25.47-2.35 2.3.56 3.23L8 10.02l-2.91 1.53.56-3.23-2.35-2.3 3.25-.47z" />
    </template>
    <template v-else-if="name === 'tag'">
      <path d="m2.75 8.35 5.7-5.7H13.25v4.8l-5.7 5.7z" />
      <circle cx="10.6" cy="5.15" r="0.85" />
    </template>
    <template v-else-if="name === 'link'">
      <path d="M6.35 9.65 4.9 11.1a2.15 2.15 0 1 1-3.04-3.04l1.45-1.45" />
      <path d="m9.65 6.35 1.45-1.45a2.15 2.15 0 1 1 3.04 3.04L12.7 9.4" />
      <path d="m6.4 9.6 3.2-3.2" />
    </template>
    <template v-else-if="name === 'history'">
      <path d="M3.25 3.5h4.1c1.2 0 2.15.95 2.15 2.15v6.6c0-.83-.67-1.5-1.5-1.5H3.25V3.5z" />
      <path d="M12.75 3.5H8.65c-1.2 0-2.15.95-2.15 2.15v6.6c0-.83.67-1.5 1.5-1.5h4.75V3.5z" />
    </template>
    <template v-else-if="name === 'more'">
      <circle cx="3.5" cy="8" r="1.05" fill="currentColor" stroke="none" />
      <circle cx="8" cy="8" r="1.05" fill="currentColor" stroke="none" />
      <circle cx="12.5" cy="8" r="1.05" fill="currentColor" stroke="none" />
    </template>
    <template v-else-if="name === 'gear'">
      <circle cx="8" cy="8" r="2.05" />
      <path
        d="M8 2.4v1.3M8 12.3v1.3M2.4 8h1.3M12.3 8h1.3M4.05 4.05l.92.92M11.03 11.03l.92.92M11.95 4.05l-.92.92M4.97 11.03l-.92.92"
      />
    </template>
  </svg>
</template>
