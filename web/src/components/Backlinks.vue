<script setup lang="ts">
import { ref } from "vue";
import { noteHref } from "../lib/paths";
import type { NoteMeta } from "../api";

defineProps<{ links: NoteMeta[] }>();

const open = ref(true);
</script>

<template>
  <section class="backlinks">
    <button
      class="backlinks-toggle"
      type="button"
      :aria-expanded="open"
      aria-controls="backlinks-content"
      @click="open = !open"
    >
      <span>Backlinks</span>
      <span aria-hidden="true">{{ open ? "Hide" : "Show" }}</span>
    </button>
    <div v-if="open" id="backlinks-content" class="backlinks-content">
      <p v-if="!links.length" class="muted">No backlinks</p>
      <ul v-else>
        <li v-for="link in links" :key="link.id">
          <RouterLink :to="noteHref(link.id)">{{ link.title }}</RouterLink>
        </li>
      </ul>
    </div>
  </section>
</template>
