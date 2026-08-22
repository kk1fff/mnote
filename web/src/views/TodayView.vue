<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { api } from "../api";
import { noteHref, todayDate } from "../lib/paths";

const router = useRouter();
const error = ref("");

onMounted(async () => {
  try {
    const note = await api.daily(todayDate());
    if (!note.id) {
      error.value = "Could not open today";
      return;
    }
    await router.replace(noteHref(note.id));
  } catch {
    error.value = "Could not open today";
  }
});
</script>

<template>
  <p class="muted results">{{ error || "Opening today…" }}</p>
</template>
