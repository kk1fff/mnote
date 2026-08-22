<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { api } from "../api";
import { renderMarkdown } from "../lib/markdown";
import { noteHref } from "../lib/paths";

const props = defineProps<{ source: string }>();
const router = useRouter();
const html = computed(() => renderMarkdown(props.source));

async function openWiki(title: string) {
  const hits = await api.titleSearch(title).catch(() => []);
  const exact = hits.find((note) => note.title.toLowerCase() === title.toLowerCase());
  if (exact) {
    await router.push(noteHref(exact.id));
    return;
  }
  const note = await api.createNote(title);
  await router.push(noteHref(note.id));
}

function onClick(event: MouseEvent) {
  const target = event.target;
  if (!(target instanceof HTMLAnchorElement)) return;
  const wiki = target.getAttribute("data-wiki");
  if (wiki) {
    event.preventDefault();
    void openWiki(wiki);
    return;
  }
  const href = target.getAttribute("href");
  if (!href?.startsWith("/n/")) return;
  event.preventDefault();
  void router.push(href);
}
</script>

<template>
  <div class="preview" v-html="html" @click="onClick" />
</template>
