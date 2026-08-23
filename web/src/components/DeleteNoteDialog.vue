<script setup lang="ts">
import { onBeforeUnmount, onMounted } from "vue";
import type { NoteMeta } from "../api";

defineProps<{
  title: string;
  links: NoteMeta[];
  error: string;
  busy: boolean;
}>();

const emit = defineEmits<{ cancel: []; confirm: [] }>();

function linkLabel(link: NoteMeta) {
  return link.folder ? `${link.folder} / ${link.title}` : link.title;
}

function onWindowKey(event: KeyboardEvent) {
  if (event.key !== "Escape") return;
  event.preventDefault();
  event.stopPropagation();
  emit("cancel");
}

onMounted(() => {
  window.addEventListener("keydown", onWindowKey, true);
});
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onWindowKey, true);
});
</script>

<template>
  <div class="park-capture-scrim" @click.self="emit('cancel')">
    <section
      class="park-capture delete-note"
      data-testid="delete-note"
      role="dialog"
      aria-modal="true"
      aria-label="Delete page"
    >
      <h2>Delete {{ title || "page" }}</h2>
      <p class="muted">
        <template v-if="links.length">
          Linked from {{ links.length }} {{ links.length === 1 ? "page" : "pages" }}. Those [[links]]
          will keep working as text.
        </template>
        <template v-else>No pages link here.</template>
      </p>
      <div v-if="links.length" class="park-context delete-note-links">
        <p v-for="link in links" :key="link.id" class="park-from">{{ linkLabel(link) }}</p>
      </div>
      <p v-if="error" class="error">{{ error }}</p>
      <div class="park-capture-actions">
        <button type="button" class="linkish" @click="emit('cancel')">Esc cancel</button>
        <button
          type="button"
          data-testid="delete-note-confirm"
          :disabled="busy"
          @click="emit('confirm')"
        >
          Delete
        </button>
      </div>
    </section>
  </div>
</template>
