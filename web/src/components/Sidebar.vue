<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api, type NoteMeta } from "../api";
import { noteIdFromRoute } from "../lib/paths";
import { noteTree } from "../lib/tree";
import { live, type LiveEvent } from "../live";
import { parkedItems, refreshParked } from "../parked";
import { currentUser, logout } from "../session";
import NoteTree from "./NoteTree.vue";

const notes = ref<NoteMeta[]>([]);
const collapsed = ref(new Set<string>());
const route = useRoute();
const router = useRouter();

const tree = computed(() => noteTree(notes.value));
const activeId = computed(() =>
  route.name === "note" || route.path.startsWith("/n/") ? noteIdFromRoute(route.params.id) : "",
);

function upsert(note: NoteMeta) {
  const i = notes.value.findIndex((n) => n.id === note.id);
  if (i >= 0) {
    const cur = notes.value[i];
    if (cur.title === note.title && (cur.folder ?? "") === (note.folder ?? "")) return;
    const next = notes.value.slice();
    next[i] = note;
    notes.value = next;
    return;
  }
  notes.value = [...notes.value, note];
}

function onLive(event: LiveEvent) {
  if (event.type === "index") upsert(event.note);
  if (event.type === "status" && event.connected) void load();
}

async function load() {
  notes.value = await api.listNotes();
}

function toggle(path: string) {
  const next = new Set(collapsed.value);
  if (next.has(path)) next.delete(path);
  else next.add(path);
  collapsed.value = next;
}

async function signOut() {
  await logout();
  await router.push("/login");
}

live.connect();
const stopLive = live.on(onLive);

onMounted(() => {
  live.connect();
  void load();
  void refreshParked().catch(() => undefined);
});

onBeforeUnmount(() => {
  stopLive();
});

const emit = defineEmits<{ "open-picker": []; "open-parked": [] }>();

defineExpose({ load });
</script>

<template>
  <aside class="sidebar" data-testid="sidebar">
    <div class="brand">
      <strong>mnote</strong>
      <span>{{ currentUser?.username }}</span>
    </div>
    <button class="new-note-button" type="button" @click="emit('open-picker')">Go to…</button>
    <button
      v-if="parkedItems.length"
      class="parked-button"
      type="button"
      data-testid="parked-count"
      @click="emit('open-parked')"
    >
      {{ parkedItems.length }} parked
    </button>
    <nav class="shortcuts" aria-label="Quick access">
      <RouterLink to="/today">Today</RouterLink>
      <RouterLink to="/recent">Recent</RouterLink>
      <RouterLink to="/favorites">Favorites</RouterLink>
    </nav>
    <div class="note-library">
      <p class="section-label">Notes</p>
      <div class="note-tree">
        <NoteTree :nodes="tree" :active-id="activeId" :collapsed="collapsed" @toggle="toggle" />
      </div>
    </div>
    <div class="sidebar-footer">
      <RouterLink to="/password">Account</RouterLink>
      <button type="button" class="linkish" @click="signOut">Sign out</button>
    </div>
  </aside>
</template>
