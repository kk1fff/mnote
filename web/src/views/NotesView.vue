<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { api, type NoteMeta } from "../api";
import AppShell from "../components/AppShell.vue";
import { isDailyNote } from "../lib/calendar";
import { noteFolderLabel } from "../lib/paths";
import { openInWorkspace } from "../workspace";

const router = useRouter();
const notes = ref<NoteMeta[]>([]);
const error = ref("");
const entries = computed(() =>
  notes.value
    .filter((note) => !isDailyNote(note))
    .sort((a, b) => b.modified_at.localeCompare(a.modified_at)),
);

async function openNote(note: NoteMeta) {
  await router.push(openInWorkspace(note.id, note.title));
}

onMounted(async () => {
  try {
    notes.value = await api.listNotes();
  } catch {
    error.value = "Could not load notes";
  }
});
</script>

<template>
  <AppShell v-slot="{ toggle }">
    <main class="main journal-view">
      <header class="journal-header notes-header">
        <button type="button" class="nav-toggle ghost" @click="toggle">Menu</button>
        <div>
          <p>Library</p>
          <h1>Notes</h1>
        </div>
      </header>
      <div class="journal-browser notes-browser">
        <section class="journal-entries">
          <p class="section-label">All notes</p>
          <p v-if="error" class="error">{{ error }}</p>
          <button
            v-for="entry in entries"
            :key="entry.id"
            type="button"
            class="journal-entry"
            data-testid="notes-entry"
            @click="void openNote(entry)"
          >
            <strong>{{ entry.title }}</strong>
            <span>{{ noteFolderLabel(entry) || "Note" }}</span>
          </button>
          <p v-if="!error && !entries.length" class="muted journal-empty">No notes yet.</p>
        </section>
      </div>
    </main>
  </AppShell>
</template>
