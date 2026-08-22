<script setup lang="ts">
import { ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ApiError } from "../api";
import { login } from "../session";

const username = ref("");
const password = ref("");
const error = ref("");
const route = useRoute();
const router = useRouter();

async function submit() {
  error.value = "";
  try {
    const me = await login(username.value.trim(), password.value);
    if (me.must_change_password) {
      await router.replace("/password");
      return;
    }
    const next = typeof route.query.next === "string" ? route.query.next : "/";
    await router.replace(next);
  } catch (err) {
    error.value = err instanceof ApiError ? "Invalid username or password" : "Login failed";
  }
}
</script>

<template>
  <main class="auth">
    <form class="card" @submit.prevent="submit">
      <h1>mnote</h1>
      <p class="muted">Use the username and temporary password your admin sent you.</p>
      <label>
        Username
        <input v-model="username" name="username" autocomplete="username" required />
      </label>
      <label>
        Password
        <input
          v-model="password"
          type="password"
          name="password"
          autocomplete="current-password"
          required
        />
      </label>
      <p v-if="error" class="error">{{ error }}</p>
      <button type="submit">Log in</button>
    </form>
  </main>
</template>
