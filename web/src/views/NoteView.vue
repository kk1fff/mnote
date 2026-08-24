<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "../api";
import AppShell from "../components/AppShell.vue";
import NotePane from "../components/NotePane.vue";
import PaneTabBar from "../components/PaneTabBar.vue";
import { noteIdFromRoute, queryValue } from "../lib/paths";
import { createLive } from "../live";
import {
  applyOpen,
  applyRoute,
  closeTab,
  collapseBeside,
  focusPane,
  isDesktop,
  layoutHref,
  setPinned,
  setRatio,
  syncFavorites,
  workspace,
  type PaneId,
  type Tab,
} from "../workspace";

const route = useRoute();
const router = useRouter();
const noteId = computed(() => noteIdFromRoute(route.params.id));
const besideId = computed(() => queryValue(route.query.beside));
const shell = ref<{ load: () => Promise<void> } | null>(null);
const workspaceEl = ref<HTMLElement | null>(null);
const desktop = ref(isDesktop());
const primaryLive = createLive();
const besideLive = createLive();
let dragging = false;
let mq: MediaQueryList | undefined;

const split = computed(() => desktop.value && !!workspace.value.beside);
const primaryWidth = computed(() => `${workspace.value.ratio * 100}%`);

watch(
  [noteId, besideId, desktop],
  ([id, beside, wide]) => {
    if (!id) return;
    if (beside && wide) applyRoute(id, beside);
    else {
      applyOpen(id, undefined, "primary");
      if (workspace.value.beside) collapseBeside();
    }
  },
  { immediate: true },
);

function syncDesktop() {
  desktop.value = mq?.matches ?? isDesktop();
}

onMounted(() => {
  mq = window.matchMedia("(min-width: 721px)");
  syncDesktop();
  mq.addEventListener("change", syncDesktop);
  void api
    .favorites()
    .then((notes) => syncFavorites(notes.map((note) => note.id)))
    .catch(() => undefined);
  window.addEventListener("pointermove", onDrag);
  window.addEventListener("pointerup", stopDrag);
});

onBeforeUnmount(() => {
  mq?.removeEventListener("change", syncDesktop);
  primaryLive.disconnect();
  besideLive.disconnect();
  window.removeEventListener("pointermove", onDrag);
  window.removeEventListener("pointerup", stopDrag);
});

async function syncUrl(replace = false) {
  const href = layoutHref();
  if (route.fullPath === href) return;
  if (replace) await router.replace(href);
  else await router.push(href);
}

async function selectTab(id: string, pane: PaneId) {
  focusPane(pane);
  applyOpen(id, undefined, pane);
  await syncUrl(true);
}

async function onClose(id: string, pane: PaneId) {
  const next = closeTab(id, pane);
  if (pane === "beside") {
    if (!workspace.value.beside?.tabs.length) {
      collapseBeside();
      await syncUrl(true);
      return;
    }
    if (!next) collapseBeside();
    await syncUrl(true);
    return;
  }
  if (!next && workspace.value.beside?.active) {
    workspace.value.primary = workspace.value.beside;
    collapseBeside();
    await syncUrl(true);
    return;
  }
  if (!next) {
    await router.push("/today");
    return;
  }
  await syncUrl(true);
}

async function onPin(tab: Tab) {
  try {
    if (tab.pinned) await api.unfavorite(tab.id);
    else await api.favorite(tab.id);
    setPinned(tab.id, !tab.pinned);
  } catch {
    /* keep prior pin state */
  }
}

function onFocus(pane: PaneId) {
  if (workspace.value.focused === pane) return;
  focusPane(pane);
  void syncUrl(true);
}

function startDrag(event: PointerEvent) {
  event.preventDefault();
  dragging = true;
}

function onDrag(event: PointerEvent) {
  if (!dragging || !workspaceEl.value) return;
  const rect = workspaceEl.value.getBoundingClientRect();
  if (!rect.width) return;
  setRatio((event.clientX - rect.left) / rect.width);
}

function stopDrag() {
  dragging = false;
}
</script>

<template>
  <AppShell ref="shell" v-slot="{ toggle }">
    <main class="main">
      <div ref="workspaceEl" class="workspace" :class="{ split }">
        <section
          class="workspace-pane"
          data-testid="pane-primary"
          :class="{ unfocused: workspace.focused !== 'primary' }"
          :style="split ? { width: primaryWidth, flex: '0 0 auto' } : undefined"
          @mousedown="onFocus('primary')"
        >
          <PaneTabBar
            :pane="workspace.primary"
            :focused="workspace.focused === 'primary'"
            @select="selectTab($event, 'primary')"
            @close="onClose($event, 'primary')"
            @pin="onPin"
          />
          <NotePane
            :note-id="workspace.primary.active || noteId"
            :toggle="toggle"
            :client="primaryLive"
            :focused="workspace.focused === 'primary'"
            @index="void shell?.load()"
          />
        </section>
        <template v-if="split">
          <div class="workspace-gutter" data-testid="split-gutter" @pointerdown="startDrag" />
          <section
            class="workspace-pane"
            data-testid="pane-beside"
            :class="{ unfocused: workspace.focused !== 'beside' }"
            @mousedown="onFocus('beside')"
          >
            <PaneTabBar
              v-if="workspace.beside"
              :pane="workspace.beside"
              :focused="workspace.focused === 'beside'"
              @select="selectTab($event, 'beside')"
              @close="onClose($event, 'beside')"
              @pin="onPin"
            />
            <NotePane
              v-if="workspace.beside?.active"
              :note-id="workspace.beside.active"
              :toggle="toggle"
              :client="besideLive"
              :focused="workspace.focused === 'beside'"
              @index="void shell?.load()"
            />
            <div v-else class="note-empty muted">Open a note</div>
          </section>
        </template>
      </div>
    </main>
  </AppShell>
</template>
