<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { api, ApiError } from "../api";
import { currentUser } from "../session";

const password = ref("");
const confirm = ref("");
const error = ref("");
const router = useRouter();
const firstLogin = computed(() => Boolean(currentUser.value?.must_change_password));

async function submit() {
  error.value = "";
  if (password.value.length < 8) {
    error.value = "Password must be at least 8 characters";
    return;
  }
  if (password.value !== confirm.value) {
    error.value = "Passwords do not match";
    return;
  }
  try {
    const me = await api.changePassword(password.value.trim());
    currentUser.value = me;
    await router.replace("/");
  } catch (err) {
    error.value = err instanceof ApiError ? err.code : "Could not change password";
  }
}
</script>

<template>
  <main class="auth">
    <form class="card" @submit.prevent="submit">
      <h1>{{ firstLogin ? "Set your password" : "Change password" }}</h1>
      <p v-if="firstLogin" class="muted">
        This account still has a temporary password. Choose one only you know.
      </p>
      <label>
        New password
        <input v-model="password" type="password" autocomplete="new-password" required />
      </label>
      <label>
        Confirm
        <input v-model="confirm" type="password" autocomplete="new-password" required />
      </label>
      <p v-if="error" class="error">{{ error }}</p>
      <button type="submit">Save</button>
    </form>
  </main>
</template>
