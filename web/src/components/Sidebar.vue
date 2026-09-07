<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api, type NoteMeta } from "../api";
import { clearDraft } from "../lib/drafts";
import { isDailyNote } from "../lib/calendar";
import { noteIdFromRoute } from "../lib/paths";
import { noteTree } from "../lib/tree";
import { live, type LiveEvent } from "../live";
import { collapsed, refreshCollapsed, toggleCollapsed } from "../folders";
import { parkedItems, refreshParked, showParkCapture } from "../parked";
import type { PickerCollection } from "../lib/picker";
import { sidebarPrefs, toggleSidebarSection } from "../sidebar";
import { applyOpen, forgetNote, layoutHref, openBeside, visibleIds } from "../workspace";
import { currentUser, logout } from "../session";
import { cycleTheme, setThemeMode, themeMode, type ThemeMode } from "../theme";
import DeleteNoteDialog from "./DeleteNoteDialog.vue";
import NoteTree from "./NoteTree.vue";
import SidebarCalendar from "./SidebarCalendar.vue";
import SidebarFold from "./SidebarFold.vue";

const themeLabel = computed(() => {
  if (themeMode.value === "light") return "Light";
  if (themeMode.value === "dark") return "Dark";
  return "System";
});

const searchShortcut = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl K";
const notes = ref<NoteMeta[]>([]);
const route = useRoute();
const router = useRouter();
const footerMenu = ref<"account" | "appearance" | null>(null);
const footerEl = ref<HTMLElement | null>(null);
const menuNote = ref<NoteMeta | null>(null);
const menuEl = ref<HTMLElement | null>(null);
const menuTop = ref(0);
const menuLeft = ref(0);
const deleteTarget = ref<NoteMeta | null>(null);
const deleteLinks = ref<NoteMeta[]>([]);
const deleteError = ref("");
const deleteBusy = ref(false);
const narrow = ref(typeof window !== "undefined" && window.matchMedia("(max-width: 720px)").matches);
let footerMq: MediaQueryList | undefined;
const themes: { id: ThemeMode; label: string }[] = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

const tree = computed(() => noteTree(notes.value));
const recentNotes = computed(() =>
  [...notes.value]
    .sort((a, b) => b.modified_at.localeCompare(a.modified_at))
    .slice(0, 5),
);
const journalDates = computed(() => {
  const dates = new Set<string>();
  for (const note of notes.value) {
    if (isDailyNote(note)) dates.add(note.title);
  }
  return dates;
});
const activeId = computed(() =>
  route.name === "note" || route.path.startsWith("/n/") ? noteIdFromRoute(route.params.id) : "",
);
const activeDaily = computed(() => {
  const note = notes.value.find((item) => item.id === activeId.value);
  return note && isDailyNote(note) ? note.title : "";
});
const openIds = computed(() => {
  const ids = visibleIds();
  if (activeId.value && !ids.includes(activeId.value)) ids.push(activeId.value);
  return ids;
});

function upsert(note: NoteMeta) {
  const i = notes.value.findIndex((n) => n.id === note.id);
  if (i >= 0) {
    const cur = notes.value[i];
    const sameTags = JSON.stringify(cur.tags ?? []) === JSON.stringify(note.tags ?? []);
    if (cur.title === note.title && (cur.folder ?? "") === (note.folder ?? "") && sameTags) return;
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

function closeMenu() {
  menuNote.value = null;
}

function openNote(id: string, event: MouseEvent) {
  event.preventDefault();
  if (event.metaKey || event.ctrlKey) openBeside(id);
  else applyOpen(id);
  void router.push(layoutHref());
}

function openBesideNote() {
  const note = menuNote.value;
  closeMenu();
  if (!note) return;
  openBeside(note.id, note.title);
  void router.push(layoutHref());
}

function openImages() {
  void router.push("/images");
}

function openJournal() {
  void router.push("/journal");
}

async function openDaily(date: string) {
  try {
    const note = await api.daily(date);
    if (!note.id) return;
    upsert({
      id: note.id,
      title: note.title,
      folder: note.folder ?? "",
      modified_at: note.modified_at,
    });
    applyOpen(note.id, note.title);
    await router.push(layoutHref());
  } catch {
    /* leave the current note */
  }
}

function openMenu(note: NoteMeta, event: MouseEvent) {
  footerMenu.value = null;
  if (menuNote.value?.id === note.id) {
    closeMenu();
    return;
  }
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  menuTop.value = rect.bottom + 6;
  menuLeft.value = Math.max(8, rect.right - 128);
  menuNote.value = note;
  void nextTick(() => {
    const box = menuEl.value?.getBoundingClientRect();
    if (!box) return;
    menuLeft.value = Math.max(8, Math.min(rect.right - box.width, window.innerWidth - box.width - 8));
    if (menuTop.value + box.height > window.innerHeight) {
      menuTop.value = Math.max(8, rect.top - box.height - 6);
    }
  });
}

async function showDelete() {
  const note = menuNote.value;
  closeMenu();
  if (!note) return;
  deleteError.value = "";
  deleteLinks.value = await api.backlinks(note.id).catch(() => []);
  deleteTarget.value = note;
}

function closeDelete() {
  if (deleteBusy.value) return;
  deleteTarget.value = null;
  deleteError.value = "";
}

async function confirmDelete() {
  const note = deleteTarget.value;
  if (!note || deleteBusy.value) return;
  deleteBusy.value = true;
  deleteError.value = "";
  try {
    await api.deleteNote(note.id);
    clearDraft(note.id);
    deleteTarget.value = null;
    notes.value = notes.value.filter((item) => item.id !== note.id);
    const wasOpen = openIds.value.includes(note.id) || activeId.value === note.id;
    forgetNote(note.id);
    if (wasOpen) await router.push(layoutHref());
  } catch {
    deleteError.value = "Could not delete";
  } finally {
    deleteBusy.value = false;
  }
}

function onFooterDocClick(event: MouseEvent) {
  const target = event.target as Node;
  if (footerMenu.value && footerEl.value && !footerEl.value.contains(target)) closeFooter();
  if (menuNote.value && menuEl.value && !menuEl.value.contains(target)) {
    if (!(event.target instanceof Element) || !event.target.closest(".tree-more")) closeMenu();
  }
}

function onFooterKey(event: KeyboardEvent) {
  if (event.key !== "Escape") return;
  if (menuNote.value) {
    closeMenu();
    return;
  }
  closeFooter();
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
  void refreshCollapsed().catch(() => undefined);
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

const emit = defineEmits<{
  "open-picker": [collection?: PickerCollection];
  "open-parked": [];
  "create-note": [];
  close: [];
}>();

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
    <button class="new-note-button ghost sidebar-search" type="button" aria-label="Search notes" @click="emit('open-picker')">
      <span>Search notes</span><kbd aria-hidden="true">{{ searchShortcut }}</kbd>
    </button>
    <button class="ghost sidebar-create" type="button" data-testid="new-note" @click="emit('create-note')">＋ New note</button>
    <div class="sidebar-group">
      <p class="section-label">Inbox</p>
      <div class="park-row">
        <button class="parked-button" type="button" data-testid="sidebar-park" title="Capture a thought to organize later" @click="showParkCapture({})">
          <span class="nav-icon inbox-icon" aria-hidden="true" />Park a thought
        </button>
      <button
        v-if="parkedItems.length"
        class="parked-count"
        type="button"
        data-testid="parked-count"
        :aria-label="`${parkedItems.length} parked`"
        @click="emit('open-parked')"
      >
        {{ parkedItems.length }}
      </button>
      </div>
    </div>
    <div class="sidebar-group library-group">
      <p class="section-label">Library</p>
      <button type="button" class="sidebar-link" :class="{ active: route.name === 'note' && !activeDaily }" @click="router.push('/today')">
        <span class="nav-icon notes-icon" aria-hidden="true" />Notes
      </button>
      <button type="button" class="sidebar-link" data-testid="sidebar-journal" :class="{ active: route.name === 'journal' || !!activeDaily }" @click="openJournal">
        <span class="nav-icon journal-icon" aria-hidden="true" />Journal
      </button>
      <button type="button" class="sidebar-link" data-testid="sidebar-images" :class="{ active: route.path === '/images' }" @click="openImages">
        <span class="nav-icon images-icon" aria-hidden="true" />Images
      </button>
    </div>
    <div class="sidebar-group">
      <p class="section-label">Organize</p>
      <button type="button" class="sidebar-link" data-testid="sidebar-favorites" @click="emit('open-picker', 'favorites')">
        <span class="nav-icon favorites-icon" aria-hidden="true" />Favorites
      </button>
      <button type="button" class="sidebar-link" data-testid="sidebar-tags" @click="emit('open-picker', 'tags')">
        <span class="nav-icon tags-icon" aria-hidden="true" />Tags
      </button>
    </div>
    <div class="note-library">
      <p class="section-label">Recent</p>
      <div class="sidebar-recent">
        <button
          v-for="note in recentNotes"
          :key="note.id"
          type="button"
          class="recent-note"
          :class="{ active: note.id === activeId }"
          @click="openNote(note.id, $event)"
        >
          <span class="nav-icon notes-icon" aria-hidden="true" /><span>{{ note.title }}</span>
        </button>
      </div>
      <p class="section-label note-list-label">All notes</p>
      <div class="note-tree">
        <NoteTree
          :nodes="tree"
          :active-ids="openIds"
          :collapsed="collapsed"
          :menu-id="menuNote?.id ?? ''"
          @toggle="toggleCollapsed"
          @menu="openMenu"
          @open="openNote"
        />
      </div>
    </div>
    <div class="sidebar-section sidebar-cal-section">
      <button
        type="button"
        class="section-toggle"
        data-testid="sidebar-cal-toggle"
        :aria-expanded="sidebarPrefs.calendarOpen"
        @click="toggleSidebarSection('calendarOpen')"
      >
        <span>Calendar</span>
        <span class="fold-chevron" :class="{ folded: !sidebarPrefs.calendarOpen }" aria-hidden="true">▾</span>
      </button>
      <SidebarFold :open="sidebarPrefs.calendarOpen">
        <SidebarCalendar
          :journal-dates="journalDates"
          :active-date="activeDaily"
          @select="void openDaily($event)"
        />
      </SidebarFold>
    </div>
    <Teleport to="body">
      <div
        v-if="menuNote"
        ref="menuEl"
        class="sidebar-popover tree-menu"
        role="menu"
        data-testid="tree-menu"
        :style="{ top: `${menuTop}px`, left: `${menuLeft}px` }"
      >
        <button type="button" role="menuitem" data-testid="tree-open-beside" @click="openBesideNote">
          Open beside
        </button>
        <button type="button" role="menuitem" data-testid="tree-delete" @click="void showDelete()">
          Delete
        </button>
      </div>
    </Teleport>
    <DeleteNoteDialog
      v-if="deleteTarget"
      :title="deleteTarget.title"
      :links="deleteLinks"
      :error="deleteError"
      :busy="deleteBusy"
      @cancel="closeDelete"
      @confirm="void confirmDelete()"
    />
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
