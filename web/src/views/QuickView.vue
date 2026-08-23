<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api } from "../api";
import { refreshParked, parkedItems } from "../parked";

const body = ref("");
const error = ref("");
const done = ref(false);
const input = ref<HTMLTextAreaElement | null>(null);

onMounted(async () => {
  input.value?.focus();
  await refreshParked().catch(() => undefined);
});

async function park() {
  const text = body.value.trim();
  if (!text) {
    error.value = "Write something first";
    return;
  }
  error.value = "";
  try {
    await api.createParked({ body: text });
    await refreshParked();
    body.value = "";
    done.value = true;
  } catch {
    error.value = "Could not park";
  }
}
</script>

<template>
  <main class="auth">
    <form class="card quick-card" data-testid="quick-form" @submit.prevent="park">
      <h1>Quick note</h1>
      <p class="muted">Dump the thought. You can file it later.</p>
      <textarea
        ref="input"
        v-model="body"
        data-testid="quick-body"
        rows="6"
        placeholder="What's on your mind?"
      />
      <p v-if="error" class="error">{{ error }}</p>
      <p v-else-if="done" class="muted" data-testid="quick-done">
        Parked. {{ parkedItems.length }} waiting.
      </p>
      <button type="submit">Park</button>
    </form>
  </main>
</template>
