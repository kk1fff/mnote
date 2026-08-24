<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { api, type ContextEvent, type HistoryEntry, type HistoryRev, type Note } from "../api";
import { contextLine } from "../lib/context";
import { ageLabel } from "../lib/excerpt";
import Preview from "./Preview.vue";

const props = defineProps<{
  noteId: string;
  current: string;
  events?: ContextEvent[];
}>();

const emit = defineEmits<{ restored: [note: Note]; reveal: [event: ContextEvent] }>();

const selectedContext = ref<number | null>(null);

const open = ref(false);
const items = ref<HistoryEntry[]>([]);
const selected = ref<"now" | string>("now");
const revision = ref<HistoryRev | null>(null);
const error = ref("");
const confirming = ref(false);
const busy = ref(false);

const previewSource = () =>
  selected.value === "now" ? props.current : (revision.value?.content ?? "");

const previewMeta = () => {
  if (selected.value === "now") return "Current version";
  if (!revision.value) return "Loading version…";
  return `${revision.value.title}${revision.value.folder ? ` · ${revision.value.folder}` : ""}`;
};

async function show() {
  error.value = "";
  confirming.value = false;
  selected.value = "now";
  selectedContext.value = null;
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

function onWindowKey(event: KeyboardEvent) {
  if (!open.value || event.key !== "Escape") return;
  event.preventDefault();
  event.stopPropagation();
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
  selectedContext.value = null;
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

onMounted(() => window.addEventListener("keydown", onWindowKey, true));
onBeforeUnmount(() => window.removeEventListener("keydown", onWindowKey, true));

defineExpose({ show, open });
</script>

<template>
  <div v-if="open" class="sheet-scrim" @click.self="close">
    <section
      class="sheet history-panel"
      data-testid="history-panel"
      role="dialog"
      aria-modal="true"
      aria-label="History"
    >
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
          <li v-if="events?.length" class="history-context-label">Context</li>
          <li v-for="event in events" :key="event.id">
            <button
              type="button"
              data-testid="history-context"
              :aria-current="selectedContext === event.id ? 'true' : undefined"
              @click="selectedContext = event.id; emit('reveal', event)"
            >
              <span>{{ contextLine(event) }}</span>
              <small>{{ event.device || event.surface }}</small>
            </button>
          </li>
        </ul>
        <div class="history-preview">
          <p class="muted history-meta">{{ previewMeta() }}</p>
          <Preview :source="previewSource()" />
          <p v-if="error" class="error parked-empty">{{ error }}</p>
          <div class="history-actions">
            <button
              v-if="selected !== 'now'"
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
    </section>
  </div>
</template>
