import { ref } from "vue";

export const SIDEBAR_KEY = "mnote:sidebar";

export type SidebarPrefs = {
  linksOpen: boolean;
  calendarOpen: boolean;
};

const defaults: SidebarPrefs = { linksOpen: true, calendarOpen: true };
const memory = new Map<string, string>();

function storageGet(): string | null {
  try {
    if (typeof localStorage !== "undefined") return localStorage.getItem(SIDEBAR_KEY);
  } catch {
    /* use memory */
  }
  return memory.get(SIDEBAR_KEY) ?? null;
}

function storageSet(value: string | null) {
  try {
    if (typeof localStorage !== "undefined") {
      if (value === null) localStorage.removeItem(SIDEBAR_KEY);
      else localStorage.setItem(SIDEBAR_KEY, value);
      return;
    }
  } catch {
    /* use memory */
  }
  if (value === null) memory.delete(SIDEBAR_KEY);
  else memory.set(SIDEBAR_KEY, value);
}

function parsePrefs(raw: string | null): SidebarPrefs {
  if (!raw) return { ...defaults };
  try {
    const parsed = JSON.parse(raw) as Partial<SidebarPrefs>;
    return {
      linksOpen: parsed.linksOpen !== false,
      calendarOpen: parsed.calendarOpen !== false,
    };
  } catch {
    return { ...defaults };
  }
}

export const sidebarPrefs = ref<SidebarPrefs>(parsePrefs(storageGet()));

function persist() {
  storageSet(JSON.stringify(sidebarPrefs.value));
}

export function toggleSidebarSection(key: keyof SidebarPrefs) {
  sidebarPrefs.value = { ...sidebarPrefs.value, [key]: !sidebarPrefs.value[key] };
  persist();
}

export function resetSidebarPrefs() {
  sidebarPrefs.value = { ...defaults };
  storageSet(null);
}
