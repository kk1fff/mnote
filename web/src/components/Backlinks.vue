<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import type { NoteMeta } from "../api";
import { openInWorkspace } from "../workspace";

defineProps<{ links: NoteMeta[] }>();

const router = useRouter();
const open = ref(true);

function openLink(link: NoteMeta) {
  void router.push(openInWorkspace(link.id, link.title));
}
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
          <a href="#" @click.prevent="openLink(link)">{{ link.title }}</a>
        </li>
      </ul>
    </div>
  </section>
</template>
