<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { setApiBase, setSessionToken } from "../api";
import { desktopInfo, markSetupDone } from "../desktop";
import { currentUser } from "../session";
import { live } from "../live";

const folder = ref("");
const error = ref("");
const busy = ref(false);
const router = useRouter();

onMounted(() => {
  const info = desktopInfo();
  folder.value = info?.folder || "";
  if (info?.error) error.value = info.error;
});

async function choose() {
  const picked = await window.mnote?.pickFolder();
  if (picked) folder.value = picked;
}

async function submit() {
  error.value = "";
  busy.value = true;
  try {
    if (!folder.value) {
      error.value = "Choose a folder for your notes.";
      return;
    }
    const result = await window.mnote?.setup({ folder: folder.value });
    if (!result) {
      error.value = "Couldn't open the folder.";
      return;
    }
    setApiBase(result.apiBase);
    setSessionToken(result.token);
    markSetupDone(result.apiBase, folder.value);
    currentUser.value = {
      username: result.username,
      must_change_password: false,
    };
    live.connect();
    await router.replace("/");
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Couldn't open the folder.";
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <main class="auth">
    <form class="card" @submit.prevent="submit">
      <h1>mnote</h1>
      <p class="muted">Notes live in a folder</p>
      <label>
        Folder
        <span class="folder-row">
          <input v-model="folder" name="folder" readonly required />
          <button type="button" class="ghost" @click="choose">Choose</button>
        </span>
      </label>
      <p v-if="error" class="error">{{ error }}</p>
      <button type="submit" :disabled="busy">Open</button>
    </form>
  </main>
</template>
