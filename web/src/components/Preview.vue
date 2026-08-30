<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { api, rewriteApiUrls } from "../api";
import { renderMarkdown } from "../lib/markdown";
import { noteIdFromRoute, parseWikiPath, sameWikiPath } from "../lib/paths";
import { openInWorkspace } from "../workspace";

const props = defineProps<{ source: string }>();
const router = useRouter();
const html = computed(() => rewriteApiUrls(renderMarkdown(props.source)));

async function openWiki(target: string) {
  const parsed = parseWikiPath(target);
  if (!parsed) return;
  const hits = await api.titleSearch(target).catch(() => []);
  const exact = hits.find((note) => sameWikiPath(note.folder ?? "", note.title, target));
  if (exact) {
    await router.push(openInWorkspace(exact.id, exact.title));
    return;
  }
  const note = await api.createNote(parsed.title, parsed.folder || undefined);
  await router.push(openInWorkspace(note.id, note.title));
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
  const id = noteIdFromRoute(href.replace(/^\/n\//, "").split("?")[0]);
  if (id) void router.push(openInWorkspace(id));
  else void router.push(href);
}
</script>

<template>
  <div class="preview" v-html="html" @click="onClick" />
</template>
