<script setup lang="ts">
import { computed, ref } from "vue";
import { monthCells, monthLabel, shiftMonth, WEEKDAYS } from "../lib/calendar";
import { todayDate } from "../lib/paths";

const props = defineProps<{
  journalDates: Set<string>;
  activeDate?: string;
}>();

const emit = defineEmits<{ select: [date: string] }>();

const now = new Date();
const year = ref(now.getFullYear());
const month = ref(now.getMonth());

const label = computed(() => monthLabel(year.value, month.value));
const cells = computed(() => monthCells(year.value, month.value));
const today = computed(() => todayDate());

function move(delta: number) {
  const next = shiftMonth(year.value, month.value, delta);
  year.value = next.year;
  month.value = next.month;
}

function classes(date: string) {
  return {
    today: date === today.value,
    journal: props.journalDates.has(date),
    active: date === props.activeDate,
  };
}
</script>

<template>
  <div class="sidebar-cal" data-testid="sidebar-cal">
    <div class="sidebar-cal-nav">
      <button type="button" class="icon-btn" data-testid="cal-prev" aria-label="Previous month" @click="move(-1)">
        ‹
      </button>
      <strong>{{ label }}</strong>
      <button type="button" class="icon-btn" data-testid="cal-next" aria-label="Next month" @click="move(1)">
        ›
      </button>
    </div>
    <div class="sidebar-cal-grid">
      <span v-for="(dow, i) in WEEKDAYS" :key="`${dow}-${i}`" class="sidebar-cal-dow">{{ dow }}</span>
      <template v-for="(cell, i) in cells" :key="cell.date || `pad-${i}`">
        <button
          v-if="cell.inMonth"
          type="button"
          class="sidebar-cal-day"
          :class="classes(cell.date)"
          :data-testid="`cal-day-${cell.date}`"
          :aria-current="cell.date === today ? 'date' : undefined"
          :aria-pressed="cell.date === activeDate"
          @click="emit('select', cell.date)"
        >
          {{ cell.day }}
        </button>
        <span v-else class="sidebar-cal-pad" />
      </template>
    </div>
  </div>
</template>
