<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { shiftMonth } from "../lib/calendar";
import {
  formatDateCandidate,
  isDayNumberQuery,
  monthOf,
  parseDateQuery,
  shiftIsoDate,
} from "../lib/date-query";
import SidebarCalendar from "./SidebarCalendar.vue";

const props = defineProps<{
  journalDates: Set<string>;
  now?: Date;
}>();

const emit = defineEmits<{
  insert: [date: string];
  cancel: [];
}>();

const root = ref<HTMLElement | null>(null);
const input = ref<HTMLInputElement | null>(null);
const query = ref("");
const override = ref<string | null>(null);
const clock = computed(() => props.now ?? new Date());
const year = ref(clock.value.getFullYear());
const month = ref(clock.value.getMonth());

const parsed = computed(() =>
  parseDateQuery(query.value, { now: clock.value, shown: { year: year.value, month: month.value } }),
);
const candidate = computed(() => override.value ?? parsed.value);
const label = computed(() => (candidate.value ? formatDateCandidate(candidate.value) : "No matching date"));

watch(query, () => {
  override.value = null;
  const date = parseDateQuery(query.value, {
    now: clock.value,
    shown: { year: year.value, month: month.value },
  });
  if (!date) return;
  const next = monthOf(date);
  year.value = next.year;
  month.value = next.month;
});

function browse(delta: number) {
  const next = shiftMonth(year.value, month.value, delta);
  year.value = next.year;
  month.value = next.month;
  if (isDayNumberQuery(query.value)) override.value = null;
}

function moveDay(days: number) {
  if (!candidate.value) return;
  override.value = shiftIsoDate(candidate.value, days);
  const next = monthOf(override.value);
  year.value = next.year;
  month.value = next.month;
}

function accept() {
  if (candidate.value) emit("insert", candidate.value);
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Enter" || event.key === "Tab") {
    event.preventDefault();
    accept();
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    emit("cancel");
    return;
  }
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    moveDay(-1);
    return;
  }
  if (event.key === "ArrowRight") {
    event.preventDefault();
    moveDay(1);
    return;
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    moveDay(-7);
    return;
  }
  if (event.key === "ArrowDown") {
    event.preventDefault();
    moveDay(7);
  }
}

function onMouseDown(event: MouseEvent) {
  if (event.target instanceof HTMLElement && event.target.closest("input")) return;
  event.preventDefault();
}

function focus() {
  input.value?.focus();
}

onMounted(() => {
  void nextTick(() => input.value?.focus());
});

defineExpose({ focus, root });
</script>

<template>
  <div
    ref="root"
    class="date-suggest"
    data-testid="date-suggest"
    role="dialog"
    aria-label="Journal date"
    @mousedown="onMouseDown"
  >
    <div class="date-suggest-field">
      <input
        ref="input"
        v-model="query"
        type="text"
        data-testid="date-suggest-input"
        aria-label="Journal date"
        placeholder="Monday, 14, 9/14…"
        @keydown="onKeydown"
      />
    </div>
    <p class="date-suggest-candidate" data-testid="date-suggest-candidate" aria-live="polite">{{ label }}</p>
    <div class="date-suggest-cal">
      <SidebarCalendar
        :journal-dates="journalDates"
        :active-date="candidate ?? undefined"
        :year="year"
        :month="month"
        @select="emit('insert', $event)"
        @browse="browse"
      />
    </div>
  </div>
</template>
