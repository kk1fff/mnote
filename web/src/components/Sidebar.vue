<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api, type NoteMeta } from "../api";
import { noteIdFromRoute } from "../lib/paths";
import { noteTree } from "../lib/tree";
import { live, type LiveEvent } from "../live";
import { parkedItems, refreshParked, showParkCapture } from "../parked";
import { currentUser, logout } from "../session";
import { cycleTheme, setThemeMode, themeMode, type ThemeMode } from "../theme";
import NoteTree from "./NoteTree.vue";

const themeLabel = computed(() => {
  if (themeMode.value === "light") return "Light";
  if (themeMode.value === "dark") return "Dark";
  return "System";
});

const notes = ref<NoteMeta[]>([]);
const collapsed = ref(new Set<string>());
const route = useRoute();
const router = useRouter();
const footerMenu = ref<"account" | "appearance" | null>(null);
const footerEl = ref<HTMLElement | null>(null);
const narrow = ref(typeof window !== "undefined" && window.matchMedia("(max-width: 720px)").matches);
let footerMq: MediaQueryList | undefined;
const themes: { id: ThemeMode; label: string }[] = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

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
  if (event.type === "deleted") {
    notes.value = notes.value.filter((note) => note.id !== event.id);
  }
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
  footerMenu.value = null;
  await logout();
  await router.push("/login");
}

function toggleFooter(menu: "account" | "appearance") {
  footerMenu.value = footerMenu.value === menu ? null : menu;
}

function closeFooter() {
  footerMenu.value = null;
}

function chooseTheme(mode: ThemeMode) {
  setThemeMode(mode);
  closeFooter();
}

function onFooterDocClick(event: MouseEvent) {
  if (!footerMenu.value || !footerEl.value) return;
  if (!footerEl.value.contains(event.target as Node)) closeFooter();
}

function onFooterKey(event: KeyboardEvent) {
  if (event.key === "Escape") closeFooter();
}

function syncNarrow() {
  narrow.value = footerMq?.matches ?? false;
  if (narrow.value) closeFooter();
}

live.connect();
const stopLive = live.on(onLive);

onMounted(() => {
  live.connect();
  void load();
  void refreshParked().catch(() => undefined);
  document.addEventListener("click", onFooterDocClick);
  document.addEventListener("keydown", onFooterKey);
  footerMq = window.matchMedia("(max-width: 720px)");
  syncNarrow();
  footerMq.addEventListener("change", syncNarrow);
});

onBeforeUnmount(() => {
  stopLive();
  document.removeEventListener("click", onFooterDocClick);
  document.removeEventListener("keydown", onFooterKey);
  footerMq?.removeEventListener("change", syncNarrow);
});

const emit = defineEmits<{ "open-picker": []; "open-parked": []; close: [] }>();

defineExpose({ load });
</script>

<template>
  <aside class="sidebar" data-testid="sidebar">
    <div class="brand">
      <div class="brand-copy">
        <strong>mnote</strong>
        <span>{{ currentUser?.username }}</span>
      </div>
      <button type="button" class="nav-close" aria-label="Close sidebar" @click="emit('close')">
        Close
      </button>
    </div>
    <button class="new-note-button" type="button" @click="emit('open-picker')">Go to…</button>
    <button class="parked-button ghost" type="button" data-testid="sidebar-park" @click="showParkCapture({})">
      Park
    </button>
    <button
      v-if="parkedItems.length"
      class="parked-button ghost"
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
    <div v-if="!narrow" ref="footerEl" class="sidebar-footer sidebar-footer-icons">
      <div class="sidebar-menu" :class="{ open: footerMenu === 'account' }">
        <button
          type="button"
          class="icon-btn"
          data-testid="account-menu"
          aria-label="Account"
          :aria-expanded="footerMenu === 'account'"
          @click="toggleFooter('account')"
        >
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <circle cx="8" cy="5.2" r="2.35" fill="none" stroke="currentColor" stroke-width="1.5" />
            <path
              d="M3.15 13.1c.55-2.35 2.35-3.55 4.85-3.55s4.3 1.2 4.85 3.55"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
            />
          </svg>
        </button>
        <div class="sidebar-popover sidebar-popover-account" role="menu">
          <p class="sidebar-popover-user">{{ currentUser?.username }}</p>
          <RouterLink to="/password" role="menuitem" @click="closeFooter">Account</RouterLink>
          <button type="button" data-testid="sign-out" role="menuitem" @click="signOut">Sign out</button>
        </div>
      </div>
      <div class="sidebar-menu" :class="{ open: footerMenu === 'appearance' }">
        <button
          type="button"
          class="icon-btn theme-toggle"
          data-testid="theme-toggle"
          aria-label="Appearance"
          :aria-expanded="footerMenu === 'appearance'"
          @click="toggleFooter('appearance')"
        >
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <circle cx="8" cy="8" r="2.05" fill="none" stroke="currentColor" stroke-width="1.5" />
            <path
              d="M6.45 1.85h3.1l.4 1.4 1.35.5 1.25-.9.85.85-.9 1.25.5 1.35 1.4.4v3.1l-1.4.4-.5 1.35.9 1.25-.85.85-1.25-.9-1.35.5-.4 1.4h-3.1l-.4-1.4-1.35-.5-1.25.9-.85-.85.9-1.25-.5-1.35-1.4-.4v-3.1l1.4-.4.5-1.35-.9-1.25.85-.85 1.25.9 1.35-.5.4-1.4z"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linejoin="round"
            />
          </svg>
        </button>
        <div class="sidebar-popover sidebar-popover-theme" role="menu">
          <button
            v-for="theme in themes"
            :key="theme.id"
            type="button"
            role="menuitemradio"
            :aria-checked="themeMode === theme.id"
            :data-testid="`theme-option-${theme.id}`"
            @click="chooseTheme(theme.id)"
          >
            {{ theme.label }}
          </button>
        </div>
      </div>
    </div>
    <div v-else class="sidebar-footer sidebar-footer-text">
      <button type="button" class="theme-toggle" @click="cycleTheme">
        <span>Appearance</span>
        <span class="muted">{{ themeLabel }}</span>
      </button>
      <RouterLink to="/password">Account</RouterLink>
      <button type="button" class="linkish" @click="signOut">Sign out</button>
    </div>
  </aside>
</template>
