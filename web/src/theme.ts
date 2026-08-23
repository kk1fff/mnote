import { ref } from "vue";

export type ThemeMode = "system" | "light" | "dark";

export const THEME_KEY = "mnote-theme";

export const themeMode = ref<ThemeMode>("system");

const memory = new Map<string, string>();

function storageGet(name: string): string | null {
  try {
    if (typeof localStorage !== "undefined") return localStorage.getItem(name);
  } catch {
    /* use memory */
  }
  return memory.get(name) ?? null;
}

function storageSet(name: string, value: string | null) {
  try {
    if (typeof localStorage !== "undefined") {
      if (value === null) localStorage.removeItem(name);
      else localStorage.setItem(name, value);
      return;
    }
  } catch {
    /* use memory */
  }
  if (value === null) memory.delete(name);
  else memory.set(name, value);
}

function prefersDark(): boolean {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

export function readThemeMode(): ThemeMode {
  const stored = storageGet(THEME_KEY);
  return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
}

export function resolvedTheme(mode: ThemeMode = themeMode.value): "light" | "dark" {
  if (mode === "light" || mode === "dark") return mode;
  return prefersDark() ? "dark" : "light";
}

export function applyTheme(mode: ThemeMode = themeMode.value): "light" | "dark" {
  const resolved = resolvedTheme(mode);
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.dataset.themeMode = mode;
  root.style.colorScheme = resolved;
  return resolved;
}

export function setThemeMode(mode: ThemeMode) {
  themeMode.value = mode;
  storageSet(THEME_KEY, mode);
  applyTheme(mode);
}

export function cycleTheme() {
  const order: ThemeMode[] = ["system", "light", "dark"];
  setThemeMode(order[(order.indexOf(themeMode.value) + 1) % order.length]);
}

export function initTheme() {
  themeMode.value = readThemeMode();
  applyTheme();
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (themeMode.value === "system") applyTheme();
  });
}
