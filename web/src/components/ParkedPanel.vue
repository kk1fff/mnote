<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { api, type Parked } from "../api";
import { openInWorkspace } from "../workspace";
import { contextLine } from "../lib/context";
import { ageLabel } from "../lib/excerpt";
import { parkedItems, pendingExcerpt, refreshParked } from "../parked";

const emit = defineEmits<{ created: [] }>();
const router = useRouter();
const open = ref(false);
const selected = ref<Parked | null>(null);
const error = ref("");

const items = computed(() => parkedItems.value);

function show(id?: number) {
  error.value = "";
  selected.value = null;
  open.value = true;
  void refreshParked().then(() => {
    if (id != null) selected.value = parkedItems.value.find((item) => item.id === id) ?? null;
  });
}

function close() {
  open.value = false;
  selected.value = null;
}

function onWindowKey(event: KeyboardEvent) {
  if (!open.value || event.key !== "Escape") return;
  event.preventDefault();
  event.stopPropagation();
  if (selected.value) {
    selected.value = null;
    return;
  }
  close();
}

async function makeNote() {
  if (!selected.value) return;
  error.value = "";
  try {
    const note = await api.parkedToNote(selected.value.id);
    await refreshParked();
    close();
    emit("created");
    await router.push(openInWorkspace(note.id, note.title));
  } catch {
    error.value = "Could not make a note";
  }
}

async function dismiss() {
  if (!selected.value) return;
  error.value = "";
  try {
    await api.deleteParked(selected.value.id);
    await refreshParked();
    selected.value = null;
    if (!parkedItems.value.length) close();
  } catch {
    error.value = "Could not dismiss";
  }
}

async function openSource() {
  if (!selected.value?.source_id) {
    error.value = "No source note";
    return;
  }
  pendingExcerpt.value = selected.value.excerpt ?? null;
  close();
  await router.push(openInWorkspace(selected.value.source_id, selected.value.source_title));
}

onMounted(() => window.addEventListener("keydown", onWindowKey, true));
onBeforeUnmount(() => window.removeEventListener("keydown", onWindowKey, true));

defineExpose({ show, open });
</script>

<template>
  <div v-if="open" class="sheet-scrim" @click.self="close">
    <section
      class="sheet parked-panel"
      data-testid="parked-panel"
      role="dialog"
      aria-modal="true"
      aria-label="Parked thoughts"
    >
      <template v-if="!selected">
        <header class="parked-panel-bar">
          <strong>Parked thoughts</strong>
          <button type="button" class="linkish" @click="close">Close</button>
        </header>
        <p v-if="!items.length" class="muted parked-empty">Nothing parked</p>
        <ul v-else class="parked-list">
          <li v-for="item in items" :key="item.id">
            <button type="button" data-testid="parked-row" @click="selected = item">
              <span>{{ item.body.split("\n")[0] }}</span>
              <small>
                {{ ageLabel(item.created_at) }}
                <template v-if="item.source_title"> · while in {{ item.source_title }}</template>
                <template v-else> · opened to dump</template>
                <template v-if="item.tags?.length"> · {{ item.tags.map((tag) => `#${tag}`).join(" ") }}</template>
              </small>
            </button>
          </li>
        </ul>
      </template>
      <template v-else>
        <header class="parked-panel-bar">
          <button type="button" class="linkish" data-testid="parked-back" @click="selected = null">
            ← all parked
          </button>
          <button type="button" class="linkish" @click="close">Close</button>
        </header>
        <div class="parked-detail">
          <p class="muted parked-meta">
            {{ ageLabel(selected.created_at) }}
            <template v-if="selected.source_title"> · while in {{ selected.source_title }}</template>
          </p>
          <p
            v-if="selected.local_time || selected.weather_label"
            class="muted parked-context"
            data-testid="parked-context"
          >
            {{
              contextLine({
                local_time: selected.local_time || selected.created_at,
                timezone: selected.timezone || "",
                captured_at: selected.created_at,
                device: selected.device,
                weather_label: selected.weather_label,
                temp_c: selected.temp_c,
              })
            }}
          </p>
          <p class="parked-body" data-testid="parked-detail">{{ selected.body }}</p>
          <blockquote v-if="selected.excerpt" class="parked-excerpt">{{ selected.excerpt }}</blockquote>
          <p v-if="error" class="error parked-empty">{{ error }}</p>
          <div class="parked-actions">
            <button type="button" data-testid="parked-make-note" @click="makeNote">Make a note</button>
            <button type="button" class="linkish" data-testid="parked-open-source" @click="openSource">
              Open source
            </button>
            <button type="button" class="linkish" data-testid="parked-dismiss" @click="dismiss">Dismiss</button>
          </div>
        </div>
      </template>
    </section>
  </div>
</template>
