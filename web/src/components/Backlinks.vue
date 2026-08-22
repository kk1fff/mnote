<script setup lang="ts">
import { noteHref } from "../lib/paths";
import type { NoteMeta } from "../api";

defineProps<{ links: NoteMeta[] }>();
</script>

<template>
  <section class="backlinks">
    <h2>Backlinks</h2>
    <p v-if="!links.length" class="muted">No backlinks</p>
    <ul v-else>
      <li v-for="link in links" :key="link.path">
        <RouterLink :to="noteHref(link.path)">{{ link.title }}</RouterLink>
      </li>
    </ul>
  </section>
</template>
