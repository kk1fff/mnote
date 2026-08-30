import { ref } from "vue";
import { api, ApiError, setSessionToken, type Me } from "./api";
import { resetCollapsed } from "./folders";
import { live } from "./live";

async function persistToken(token: string | null) {
  setSessionToken(token);
  await window.mnote?.setToken(token);
}

export const currentUser = ref<Me | null>(null);
export const sessionReady = ref(false);

export async function refreshSession(): Promise<Me | null> {
  try {
    currentUser.value = await api.me();
    if (currentUser.value && !currentUser.value.must_change_password) {
      live.connect();
    }
  } catch (err) {
    currentUser.value = null;
    live.disconnect();
    if (err instanceof ApiError && err.status === 401) await persistToken(null);
  } finally {
    sessionReady.value = true;
  }
  return currentUser.value;
}

export async function login(username: string, password: string): Promise<Me> {
  const me = await api.login(username, password);
  await persistToken(me.token ?? null);
  currentUser.value = me;
  sessionReady.value = true;
  if (!me.must_change_password) live.connect();
  return me;
}

export async function logout(): Promise<void> {
  try {
    await api.logout();
  } finally {
    await persistToken(null);
    currentUser.value = null;
    resetCollapsed();
    live.disconnect();
  }
}
