<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "../api";
import AppShell from "../components/AppShell.vue";
import NotePane from "../components/NotePane.vue";
import PaneTabBar from "../components/PaneTabBar.vue";
import { noteHref, noteIdFromRoute } from "../lib/paths";
import { applyOpen, closeTab, setPinned, syncFavorites, workspace, type Tab } from "../workspace";

const route = useRoute();
const router = useRouter();
const noteId = computed(() => noteIdFromRoute(route.params.id));
const shell = ref<{ load: () => Promise<void> } | null>(null);

watch(
  noteId,
  (id) => {
    if (id) applyOpen(id);
  },
  { immediate: true },
);

onMounted(() => {
  void api
    .favorites()
    .then((notes) => syncFavorites(notes.map((note) => note.id)))
    .catch(() => undefined);
});

async function openTab(id: string) {
  if (id === noteId.value) return;
  await router.push(noteHref(id));
}

async function onClose(id: string) {
  const next = closeTab(id, "primary");
  if (id !== noteId.value) return;
  await router.push(next ? noteHref(next) : "/today");
}

async function onPin(tab: Tab) {
  try {
    if (tab.pinned) await api.unfavorite(tab.id);
    else await api.favorite(tab.id);
    setPinned(tab.id, !tab.pinned);
  } catch {
    /* keep prior pin state */
  }
}
</script>

<template>
  <AppShell ref="shell" v-slot="{ toggle }">
    <main class="main">
      <PaneTabBar :pane="workspace.primary" :focused="true" @select="openTab" @close="onClose" @pin="onPin" />
      <NotePane :note-id="noteId" :toggle="toggle" @index="void shell?.load()" />
    </main>
  </AppShell>
</template>
