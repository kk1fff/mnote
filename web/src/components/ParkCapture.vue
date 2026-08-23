<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { api } from "../api";
import { parkContext, refreshParked, registerCapture, type ParkContext } from "../parked";

const open = ref(false);
const body = ref("");
const ctx = ref<ParkContext>({});
const error = ref("");
const input = ref<HTMLTextAreaElement | null>(null);

function show(next?: ParkContext) {
  ctx.value = next ?? parkContext();
  body.value = "";
  error.value = "";
  open.value = true;
  void nextTick(() => input.value?.focus());
}

function close() {
  open.value = false;
}

async function park() {
  const text = body.value.trim();
  if (!text) {
    error.value = "Write something first";
    return;
  }
  error.value = "";
  try {
    await api.createParked({
      body: text,
      source_id: ctx.value.source_id,
      source_title: ctx.value.source_title,
      source_folder: ctx.value.source_folder,
      excerpt: ctx.value.excerpt,
    });
    await refreshParked();
    close();
  } catch {
    error.value = "Could not park";
  }
}

const parkShortcut = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? "⌘↵" : "Ctrl+↵";

function onKey(event: KeyboardEvent) {
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
      />
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
