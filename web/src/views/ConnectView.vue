<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { setApiBase } from "../api";

const server = ref("");
const error = ref("");
const busy = ref(false);
const router = useRouter();

async function submit() {
  error.value = "";
  busy.value = true;
  try {
    const host = server.value.trim();
    if (!host) {
      error.value = "Enter the server address.";
      return;
    }
    const result = await window.mnote?.setServer(host);
    if (!result?.ok) {
      error.value = result?.error || "Can't reach the server.";
      return;
    }
    setApiBase(result.apiBase ?? null);
    await router.replace("/login");
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <main class="auth">
    <form class="card" @submit.prevent="submit">
      <h1>mnote</h1>
      <p class="muted">Connect to your server</p>
      <label>
        Server
        <input
          v-model="server"
          name="server"
          placeholder="192.168.1.10:3000"
          autocomplete="off"
          required
        />
      </label>
      <p v-if="error" class="error">{{ error }}</p>
      <button type="submit" :disabled="busy">Connect</button>
    </form>
  </main>
</template>
