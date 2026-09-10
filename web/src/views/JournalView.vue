<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api, type NoteMeta } from "../api";
import AppShell from "../components/AppShell.vue";
import NavIcon from "../components/NavIcon.vue";
import SidebarCalendar from "../components/SidebarCalendar.vue";
import { isDailyNote, shiftMonth } from "../lib/calendar";
import { todayDate } from "../lib/paths";
import { openInWorkspace } from "../workspace";

const route = useRoute();
const router = useRouter();
const notes = ref<NoteMeta[]>([]);
const error = ref("");
const entries = computed(() => notes.value.filter(isDailyNote).sort((a, b) => b.title.localeCompare(a.title)));
const dates = computed(() => new Set(entries.value.map((entry) => entry.title)));
const selected = ref("");
const calYear = computed(() => {
  const year = Number(route.query.year);
  return Number.isFinite(year) ? year : undefined;
});
const calMonth = computed(() => {
  const month = Number(route.query.month);
  if (Number.isFinite(month) && month >= 1 && month <= 12) return month - 1;
  return calYear.value != null ? 0 : undefined;
});

function onBrowse(delta: number) {
  const now = new Date();
  const next = shiftMonth(calYear.value ?? now.getFullYear(), calMonth.value ?? now.getMonth(), delta);
  void router.replace({ path: "/journal", query: { year: String(next.year), month: String(next.month + 1) } });
}

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
        <button type="button" class="nav-toggle ghost" aria-label="Menu" @click="toggle">
          <NavIcon name="menu" />
        </button>
        <div>
          <p>Library</p>
          <h1>Journal</h1>
        </div>
        <button type="button" class="journal-today" @click="void openDate(todayDate())">Today</button>
      </header>
      <div class="journal-browser">
        <section class="journal-calendar-card">
          <SidebarCalendar
            :journal-dates="dates"
            :active-date="selected"
            :year="calYear"
            :month="calMonth"
            @select="void openDate($event)"
            @browse="onBrowse"
          />
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
