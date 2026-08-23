<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { api, type Parked } from "../api";
import { noteHref } from "../lib/paths";
import { ageLabel } from "../lib/excerpt";
import { parkedItems, pendingExcerpt, refreshParked } from "../parked";

const emit = defineEmits<{ created: [] }>();
const router = useRouter();
const open = ref(false);
const selected = ref<Parked | null>(null);
const error = ref("");

const items = computed(() => parkedItems.value);

function show() {
  error.value = "";
  selected.value = null;
  open.value = true;
  void refreshParked();
}

function close() {
  open.value = false;
  selected.value = null;
}

function onKey(event: KeyboardEvent) {
  if (event.key !== "Escape") return;
  event.preventDefault();
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
    await router.push(noteHref(note.id));
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
  await router.push(noteHref(selected.value.source_id));
}

defineExpose({ show, open });
</script>

<template>
  <div v-if="open" class="parked-panel" data-testid="parked-panel" @keydown="onKey">
    <template v-if="!selected">
      <header class="parked-panel-bar">
        <strong>Parked</strong>
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
      <p class="parked-body" data-testid="parked-detail">{{ selected.body }}</p>
      <p class="muted">{{ ageLabel(selected.created_at) }}</p>
      <p v-if="selected.source_title" class="muted">while in {{ selected.source_title }}</p>
      <blockquote v-if="selected.excerpt" class="parked-excerpt">{{ selected.excerpt }}</blockquote>
      <p v-if="error" class="error">{{ error }}</p>
      <div class="parked-actions">
        <button type="button" data-testid="parked-make-note" @click="makeNote">Make a note</button>
        <button type="button" class="linkish" data-testid="parked-open-source" @click="openSource">
          Open source
        </button>
        <button type="button" class="linkish" data-testid="parked-dismiss" @click="dismiss">Dismiss</button>
      </div>
    </template>
  </div>
</template>
