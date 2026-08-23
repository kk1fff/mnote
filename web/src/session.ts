import { ref } from "vue";
import { api, type Me } from "./api";
import { resetCollapsed } from "./folders";
import { live } from "./live";

export const currentUser = ref<Me | null>(null);
export const sessionReady = ref(false);

export async function refreshSession(): Promise<Me | null> {
  try {
    currentUser.value = await api.me();
    if (currentUser.value && !currentUser.value.must_change_password) {
      live.connect();
    }
  } catch {
    currentUser.value = null;
    live.disconnect();
  } finally {
    sessionReady.value = true;
  }
  return currentUser.value;
}

export async function login(username: string, password: string): Promise<Me> {
  const me = await api.login(username, password);
  currentUser.value = me;
  sessionReady.value = true;
  if (!me.must_change_password) live.connect();
  return me;
}

export async function logout(): Promise<void> {
  try {
    await api.logout();
  } finally {
    currentUser.value = null;
    resetCollapsed();
    live.disconnect();
  }
}
