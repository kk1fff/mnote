<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { renderMarkdown } from "../lib/markdown";

const props = defineProps<{ source: string }>();
const router = useRouter();
const html = computed(() => renderMarkdown(props.source));

function onClick(event: MouseEvent) {
  const target = event.target;
  if (!(target instanceof HTMLAnchorElement)) return;
  const href = target.getAttribute("href");
  if (!href?.startsWith("/n/")) return;
  event.preventDefault();
  void router.push(href);
}
</script>

<template>
  <div class="preview" v-html="html" @click="onClick" />
</template>
