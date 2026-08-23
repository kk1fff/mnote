<script setup lang="ts">
import { ref } from "vue";
import { api, type HistoryEntry, type HistoryRev, type Note } from "../api";
import { ageLabel } from "../lib/excerpt";
import Preview from "./Preview.vue";

const props = defineProps<{
  noteId: string;
  current: string;
}>();

const emit = defineEmits<{ restored: [note: Note] }>();

const open = ref(false);
const items = ref<HistoryEntry[]>([]);
const selected = ref<"now" | string>("now");
const revision = ref<HistoryRev | null>(null);
const error = ref("");
const confirming = ref(false);
const busy = ref(false);

const previewSource = () =>
  selected.value === "now" ? props.current : (revision.value?.content ?? "");

async function show() {
  error.value = "";
  confirming.value = false;
  selected.value = "now";
  revision.value = null;
  open.value = true;
  try {
    items.value = await api.noteHistory(props.noteId);
  } catch {
    error.value = "Could not load history";
    items.value = [];
  }
}

function close() {
  open.value = false;
  confirming.value = false;
}

function onKey(event: KeyboardEvent) {
  if (event.key !== "Escape") return;
  event.preventDefault();
  if (confirming.value) {
    confirming.value = false;
    return;
  }
  close();
}

async function select(rev: string) {
  error.value = "";
  confirming.value = false;
  selected.value = rev;
  if (rev === "now") {
    revision.value = null;
    return;
  }
  try {
    revision.value = await api.noteRevision(props.noteId, rev);
  } catch {
    error.value = "Could not load version";
    revision.value = null;
  }
}

async function restore() {
  if (selected.value === "now" || !revision.value) return;
  if (!confirming.value) {
    confirming.value = true;
    return;
  }
  error.value = "";
  busy.value = true;
  try {
    const note = await api.restoreNote(props.noteId, selected.value);
    close();
    emit("restored", note);
  } catch {
    error.value = "Could not restore";
    confirming.value = false;
  } finally {
    busy.value = false;
  }
}

defineExpose({ show, open });
</script>

<template>
  <div v-if="open" class="history-panel" data-testid="history-panel" @keydown="onKey">
    <header class="history-panel-bar">
      <strong>History</strong>
      <button type="button" class="linkish" @click="close">Close</button>
    </header>
    <div class="history-split">
      <ul class="history-list">
        <li>
          <button
            type="button"
            data-testid="history-now"
            :aria-current="selected === 'now' ? 'true' : undefined"
            @click="select('now')"
          >
            <span>Now</span>
            <small>current</small>
          </button>
        </li>
        <li v-for="item in items" :key="item.rev">
          <button
            type="button"
            data-testid="history-row"
            :aria-current="selected === item.rev ? 'true' : undefined"
            @click="select(item.rev)"
          >
            <span>{{ ageLabel(item.created_at) }}</span>
            <small>{{ item.created_at }}</small>
          </button>
        </li>
      </ul>
      <div class="history-preview">
        <p v-if="selected !== 'now' && revision" class="muted">
          {{ revision.title }}{{ revision.folder ? ` · ${revision.folder}` : "" }}
        </p>
        <Preview :source="previewSource()" />
        <p v-if="error" class="error">{{ error }}</p>
        <div v-if="selected !== 'now'" class="history-actions">
          <button
            type="button"
            data-testid="history-restore"
            :disabled="busy || !revision"
            @click="restore"
          >
            {{ confirming ? "Confirm restore" : "Restore" }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
