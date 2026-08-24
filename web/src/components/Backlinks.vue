<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import type { NoteMeta } from "../api";
import { openInWorkspace } from "../workspace";

defineProps<{ links: NoteMeta[] }>();

const router = useRouter();
const open = ref(false);

function openLink(link: NoteMeta) {
  void router.push(openInWorkspace(link.id, link.title));
}
</script>

<template>
  <section class="backlinks">
    <button
      class="backlinks-toggle"
      type="button"
      :aria-expanded="open && !!links.length"
      aria-controls="backlinks-content"
      @click="links.length && (open = !open)"
    >
      <span>Backlinks</span>
      <span v-if="links.length" class="muted">{{ links.length }}</span>
    </button>
    <div v-if="open && links.length" id="backlinks-content" class="backlinks-content">
      <ul>
        <li v-for="link in links" :key="link.id">
          <a href="#" @click.prevent="openLink(link)">{{ link.title }}</a>
        </li>
      </ul>
    </div>
  </section>
</template>
