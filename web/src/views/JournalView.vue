<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { api, type NoteMeta } from "../api";
import AppShell from "../components/AppShell.vue";
import SidebarCalendar from "../components/SidebarCalendar.vue";
import { isDailyNote } from "../lib/calendar";
import { todayDate } from "../lib/paths";
import { openInWorkspace } from "../workspace";

const router = useRouter();
const notes = ref<NoteMeta[]>([]);
const error = ref("");
const entries = computed(() => notes.value.filter(isDailyNote).sort((a, b) => b.title.localeCompare(a.title)));
const dates = computed(() => new Set(entries.value.map((entry) => entry.title)));
const selected = ref("");

async function openDate(date: string) {
  try {
    const note = await api.daily(date);
    selected.value = note.title;
    await router.push(openInWorkspace(note.id, note.title));
  } catch {
    error.value = "Could not open this journal entry";
  }
}

function displayDate(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

onMounted(async () => {
  try {
    notes.value = await api.listNotes();
  } catch {
    error.value = "Could not load journal entries";
  }
});
</script>

<template>
  <AppShell v-slot="{ toggle }">
    <main class="main journal-view">
      <header class="journal-header">
        <button type="button" class="nav-toggle ghost" @click="toggle">Menu</button>
        <div>
          <p>Library</p>
          <h1>Journal</h1>
        </div>
        <button type="button" class="journal-today" @click="void openDate(todayDate())">Today</button>
      </header>
      <div class="journal-browser">
        <section class="journal-calendar-card">
          <SidebarCalendar :journal-dates="dates" :active-date="selected" @select="void openDate($event)" />
        </section>
        <section class="journal-entries">
          <p class="section-label">Recent entries</p>
          <p v-if="error" class="error">{{ error }}</p>
          <button v-for="entry in entries" :key="entry.id" type="button" class="journal-entry" @click="void openDate(entry.title)">
            <strong>{{ displayDate(entry.title) }}</strong>
            <span>{{ entry.tags?.length ? `#${entry.tags.join(" #")}` : "Journal entry" }}</span>
          </button>
          <p v-if="!error && !entries.length" class="muted journal-empty">No journal entries yet. Start with today.</p>
        </section>
      </div>
    </main>
  </AppShell>
</template>
