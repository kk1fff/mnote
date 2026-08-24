<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute } from "vue-router";
import AppShell from "../components/AppShell.vue";
import NotePane from "../components/NotePane.vue";
import { noteIdFromRoute } from "../lib/paths";

const route = useRoute();
const noteId = computed(() => noteIdFromRoute(route.params.id));
const shell = ref<{ load: () => Promise<void> } | null>(null);
</script>

<template>
  <AppShell ref="shell" v-slot="{ toggle }">
    <NotePane :note-id="noteId" :toggle="toggle" @index="void shell?.load()" />
  </AppShell>
</template>
