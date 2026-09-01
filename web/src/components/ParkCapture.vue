<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { api, type TagSuggest } from "../api";
import { stamp } from "../lib/context";
import { completeTag, detectTrigger } from "../lib/suggest";
import { parkContext, refreshParked, registerCapture, type ParkContext } from "../parked";

const open = ref(false);
const body = ref("");
const ctx = ref<ParkContext>({});
const error = ref("");
const input = ref<HTMLTextAreaElement | null>(null);
const menu = ref<{ from: number; items: TagSuggest[] } | null>(null);
const selected = ref(0);
const menuPos = ref({ top: 0, left: 0 });
let searchTimer: number | undefined;
let searchId = 0;

function show(next?: ParkContext) {
  ctx.value = next ?? parkContext();
  body.value = "";
  error.value = "";
  open.value = true;
  void nextTick(() => input.value?.focus());
}

function close() {
  open.value = false;
  menu.value = null;
}

function cursor(): number {
  return input.value?.selectionStart ?? body.value.length;
}

function placeMenu() {
  const el = input.value;
  if (!el) return;
  const box = el.getBoundingClientRect();
  menuPos.value = { top: box.bottom + 6, left: box.left };
}

async function syncMenu() {
  const trigger = detectTrigger(body.value, cursor());
  if (!trigger || trigger.mode !== "tag") {
    menu.value = null;
    return;
  }
  const id = ++searchId;
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(async () => {
    const hits = await api
      .suggestTags({
        q: trigger.query,
        title: ctx.value.source_title,
        folder: ctx.value.source_folder,
        content: `${ctx.value.excerpt ?? ""}\n${body.value}`,
        cursor: (ctx.value.excerpt ?? "").length + 1 + trigger.from,
      })
      .catch(() => []);
    if (id !== searchId) return;
    const still = detectTrigger(body.value, cursor());
    if (!still || still.mode !== "tag") return;
    menu.value = { from: still.from, items: hits };
    selected.value = 0;
    placeMenu();
  }, 120);
}

function acceptTag(index = selected.value) {
  const item = menu.value?.items[index];
  const from = menu.value?.from;
  if (!item || from == null) return;
  const to = cursor();
  body.value = body.value.slice(0, from) + completeTag(item.name) + body.value.slice(to);
  menu.value = null;
  void nextTick(() => {
    const pos = from + item.name.length + 1;
    input.value?.setSelectionRange(pos, pos);
    input.value?.focus();
  });
}

async function park() {
  const text = body.value.trim();
  if (!text) {
    error.value = "Write something first";
    return;
  }
  error.value = "";
  try {
    const s = stamp("park");
    await api.createParked({
      body: text,
      source_id: ctx.value.source_id,
      source_title: ctx.value.source_title,
      source_folder: ctx.value.source_folder,
      excerpt: ctx.value.excerpt,
      surface: s.surface,
      device: s.device,
      local_time: s.local_time,
      timezone: s.timezone,
      lat: s.lat,
      lon: s.lon,
      accuracy_m: s.accuracy_m,
    });
    await refreshParked();
    close();
  } catch {
    error.value = "Could not park";
  }
}

const parkShortcut = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? "⌘↵" : "Ctrl+↵";

function onKey(event: KeyboardEvent) {
  if (menu.value?.items.length) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      selected.value = (selected.value + 1) % menu.value.items.length;
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      selected.value = (selected.value - 1 + menu.value.items.length) % menu.value.items.length;
      return;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      acceptTag();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      menu.value = null;
      return;
    }
  }
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    close();
  }
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    event.stopPropagation();
    void park();
  }
}

function onWindowKey(event: KeyboardEvent) {
  if (!open.value || event.key !== "Escape") return;
  event.preventDefault();
  event.stopPropagation();
  close();
}

onMounted(() => {
  registerCapture(show);
  window.addEventListener("keydown", onWindowKey, true);
});
onBeforeUnmount(() => {
  registerCapture(null);
  window.removeEventListener("keydown", onWindowKey, true);
});

defineExpose({ show, open });
</script>

<template>
  <div v-if="open" class="park-capture-scrim" @click.self="close">
    <section class="park-capture" data-testid="park-capture" role="dialog" aria-modal="true" aria-label="Park a thought">
      <h2>Park this</h2>
      <textarea
        ref="input"
        v-model="body"
        data-testid="park-body"
        placeholder="Dump the thought"
        @keydown="onKey"
        @input="syncMenu"
      />
      <Teleport to="body">
        <div
          v-if="menu?.items.length"
          class="suggest-menu"
          data-testid="park-suggest"
          role="listbox"
          :style="{ top: `${menuPos.top}px`, left: `${menuPos.left}px` }"
        >
          <button
            v-for="(item, index) in menu.items"
            :key="item.name"
            type="button"
            :class="{ active: selected === index }"
            @mousedown.prevent="acceptTag(index)"
          >
            <span>#{{ item.name }}</span>
            <small :class="{ 'suggest-new': item.create }">{{ item.create ? "New" : item.count }}</small>
          </button>
        </div>
      </Teleport>
      <div v-if="ctx.source_title" class="park-context">
        <p class="muted park-from">From {{ ctx.source_title }}</p>
        <blockquote v-if="ctx.excerpt">{{ ctx.excerpt }}</blockquote>
      </div>
      <p v-if="error" class="error">{{ error }}</p>
      <div class="park-capture-actions">
        <button type="button" class="linkish" @click="close">Esc cancel</button>
        <button type="button" data-testid="park-save" @click="park">Park {{ parkShortcut }}</button>
      </div>
    </section>
  </div>
</template>
