import { ref } from "vue";
import { noteHref } from "./lib/paths";

export type PaneId = "primary" | "beside";
export type OpenMode = "replace" | "add";

export type Tab = {
  id: string;
  title: string;
  pinned: boolean;
};

export type Pane = {
  tabs: Tab[];
  active: string;
};

export type Workspace = {
  primary: Pane;
  beside: Pane | null;
  focused: PaneId;
  ratio: number;
};

export const WORKSPACE_KEY = "mnote:workspace";
export const UNPINNED_CAP = 12;

const emptyPane = (): Pane => ({ tabs: [], active: "" });

export function emptyWorkspace(): Workspace {
  return { primary: emptyPane(), beside: null, focused: "primary", ratio: 0.5 };
}

const memory = new Map<string, string>();

export const workspace = ref<Workspace>(loadWorkspace());

function fallbackTitle(id: string): string {
  const parts = id.split("/").filter(Boolean);
  return parts[parts.length - 1] || id;
}

function readStore(): string | null {
  try {
    if (typeof localStorage !== "undefined") return localStorage.getItem(WORKSPACE_KEY);
  } catch {
    /* use memory */
  }
  return memory.get(WORKSPACE_KEY) ?? null;
}

function writeStore(value: string | null) {
  try {
    if (typeof localStorage !== "undefined") {
      if (value === null) localStorage.removeItem(WORKSPACE_KEY);
      else localStorage.setItem(WORKSPACE_KEY, value);
      return;
    }
  } catch {
    /* use memory */
  }
  if (value === null) memory.delete(WORKSPACE_KEY);
  else memory.set(WORKSPACE_KEY, value);
}

function asTab(raw: unknown): Tab | null {
  if (!raw || typeof raw !== "object") return null;
  const tab = raw as Partial<Tab>;
  if (typeof tab.id !== "string" || !tab.id) return null;
  return {
    id: tab.id,
    title: typeof tab.title === "string" && tab.title ? tab.title : fallbackTitle(tab.id),
    pinned: !!tab.pinned,
  };
}

function asPane(raw: unknown): Pane | null {
  if (!raw || typeof raw !== "object") return null;
  const pane = raw as Partial<Pane>;
  const tabs = Array.isArray(pane.tabs) ? pane.tabs.map(asTab).filter((tab): tab is Tab => !!tab) : [];
  const seen = new Set<string>();
  const unique = tabs.filter((tab) => {
    if (seen.has(tab.id)) return false;
    seen.add(tab.id);
    return true;
  });
  const active = typeof pane.active === "string" && seen.has(pane.active) ? pane.active : (unique[0]?.id ?? "");
  return { tabs: unique, active };
}

export function loadWorkspace(): Workspace {
  const raw = readStore();
  if (!raw) return emptyWorkspace();
  try {
    const parsed = JSON.parse(raw) as Partial<Workspace>;
    const primary = asPane(parsed.primary) ?? emptyPane();
    const beside = parsed.beside == null ? null : asPane(parsed.beside);
    const focused: PaneId = parsed.focused === "beside" && beside ? "beside" : "primary";
    const ratio =
      typeof parsed.ratio === "number" && Number.isFinite(parsed.ratio)
        ? Math.min(0.72, Math.max(0.28, parsed.ratio))
        : 0.5;
    return { primary, beside, focused, ratio };
  } catch {
    return emptyWorkspace();
  }
}

export function persistWorkspace() {
  writeStore(JSON.stringify(workspace.value));
}

export function resetWorkspace(next = emptyWorkspace()) {
  workspace.value = next;
  writeStore(next.primary.tabs.length || next.beside ? JSON.stringify(next) : null);
}

export function paneOf(id: PaneId, state = workspace.value): Pane | null {
  return id === "beside" ? state.beside : state.primary;
}

export function focusedPane(state = workspace.value): Pane {
  return paneOf(state.focused, state) ?? state.primary;
}

export function splitTabs(pane: Pane): { pinned: Tab[]; rest: Tab[] } {
  return {
    pinned: pane.tabs.filter((tab) => tab.pinned),
    rest: pane.tabs.filter((tab) => !tab.pinned),
  };
}

function evictUnpinned(pane: Pane) {
  const unpinned = pane.tabs.filter((tab) => !tab.pinned);
  if (unpinned.length <= UNPINNED_CAP) return;
  const drop = unpinned.find((tab) => tab.id !== pane.active) ?? unpinned[0];
  pane.tabs = pane.tabs.filter((tab) => tab.id !== drop.id);
}

function upsertTab(pane: Pane, id: string, title?: string, pinned?: boolean): Tab {
  const existing = pane.tabs.find((tab) => tab.id === id);
  if (existing) {
    if (title) existing.title = title;
    if (pinned != null) existing.pinned = pinned;
    return existing;
  }
  const tab: Tab = { id, title: title || fallbackTitle(id), pinned: !!pinned };
  pane.tabs = [...pane.tabs, tab];
  evictUnpinned(pane);
  return tab;
}

export function rememberTitle(id: string, title: string) {
  if (!title) return;
  for (const pane of [workspace.value.primary, workspace.value.beside]) {
    const tab = pane?.tabs.find((item) => item.id === id);
    if (tab) tab.title = title;
  }
  persistWorkspace();
}

export function setPinned(id: string, pinned: boolean) {
  for (const pane of [workspace.value.primary, workspace.value.beside]) {
    const tab = pane?.tabs.find((item) => item.id === id);
    if (tab) tab.pinned = pinned;
  }
  persistWorkspace();
}

export function applyOpen(
  id: string,
  title?: string,
  paneId: PaneId = workspace.value.focused,
  takeFocus = true,
  mode: OpenMode = "replace",
) {
  if (!id) return;
  const state = workspace.value;
  const targetId = paneId === "beside" && !state.beside ? "primary" : paneId;
  if (targetId === "beside" && !state.beside) return;
  const pane = paneOf(targetId, state);
  if (!pane) return;
  const existing = pane.tabs.find((tab) => tab.id === id);
  if (existing) {
    pane.active = id;
    if (title) existing.title = title;
    if (takeFocus) state.focused = targetId;
    persistWorkspace();
    return;
  }
  const active = pane.tabs.find((tab) => tab.id === pane.active);
  if (mode === "replace" && active && !active.pinned) {
    const index = pane.tabs.indexOf(active);
    pane.tabs[index] = {
      id,
      title: title || fallbackTitle(id),
      pinned: false,
    };
    pane.active = id;
  } else {
    upsertTab(pane, id, title);
    pane.active = id;
  }
  evictUnpinned(pane);
  if (takeFocus) state.focused = targetId;
  persistWorkspace();
}

export function isDesktop(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(min-width: 721px)").matches
  );
}

export function focusPane(id: PaneId) {
  if (id === "beside" && !workspace.value.beside) return;
  workspace.value.focused = id;
  persistWorkspace();
}

export function setRatio(ratio: number) {
  workspace.value.ratio = Math.min(0.72, Math.max(0.28, ratio));
  persistWorkspace();
}

export function ensureBeside(): Pane {
  if (!workspace.value.beside) workspace.value.beside = { tabs: [], active: "" };
  return workspace.value.beside;
}

export function collapseBeside() {
  workspace.value.beside = null;
  workspace.value.focused = "primary";
  persistWorkspace();
}

export function openBeside(id: string, title?: string) {
  if (!id) return;
  if (!isDesktop()) {
    applyOpen(id, title, "primary");
    return;
  }
  ensureBeside();
  applyOpen(id, title, "beside");
}

export function applyRoute(focusId: string, besideId: string) {
  if (!focusId) return;
  if (!besideId || !isDesktop()) {
    applyOpen(focusId, undefined, "primary");
    if (workspace.value.beside) collapseBeside();
    return;
  }
  const state = workspace.value;
  if (state.focused === "beside") {
    ensureBeside();
    applyOpen(focusId, undefined, "beside", true);
    applyOpen(besideId, undefined, "primary", false);
    return;
  }
  applyOpen(focusId, undefined, "primary", true);
  ensureBeside();
  applyOpen(besideId, undefined, "beside", false);
}

export function layoutHref(): string {
  const state = workspace.value;
  const focus = focusedPane(state);
  const other = state.focused === "beside" ? state.primary : state.beside;
  if (!focus.active) return "/today";
  if (other?.active && isDesktop()) return noteHref(focus.active, { beside: other.active });
  return noteHref(focus.active);
}

export function openInWorkspace(id: string, title?: string, mode: OpenMode = "replace"): string {
  applyOpen(id, title, workspace.value.focused, true, mode);
  return layoutHref();
}

export function visibleIds(state = workspace.value): string[] {
  const ids = [state.primary.active];
  if (state.beside?.active) ids.push(state.beside.active);
  return ids.filter(Boolean);
}

export function forgetNote(id: string): string {
  if (!id) return layoutHref();
  closeTab(id, "primary");
  if (workspace.value.beside) {
    closeTab(id, "beside");
    if (!workspace.value.beside.tabs.length) collapseBeside();
  }
  if (!workspace.value.primary.active && workspace.value.beside?.active) {
    workspace.value.primary = workspace.value.beside;
    collapseBeside();
  }
  persistWorkspace();
  return layoutHref();
}

export function closeTab(id: string, paneId: PaneId = workspace.value.focused): string | null {
  const pane = paneOf(paneId);
  if (!pane) return null;
  const index = pane.tabs.findIndex((tab) => tab.id === id);
  if (index < 0) return pane.active || null;
  pane.tabs = pane.tabs.filter((tab) => tab.id !== id);
  if (pane.active === id) {
    const neighbor = pane.tabs[index] ?? pane.tabs[index - 1] ?? null;
    pane.active = neighbor?.id ?? "";
  }
  persistWorkspace();
  return pane.active || null;
}

export function syncFavorites(ids: Iterable<string>) {
  const fav = new Set(ids);
  for (const pane of [workspace.value.primary, workspace.value.beside]) {
    if (!pane) continue;
    for (const tab of pane.tabs) tab.pinned = fav.has(tab.id);
  }
  persistWorkspace();
}

let showPickerFn: ((mode?: OpenMode) => void) | null = null;

export function registerPicker(fn: ((mode?: OpenMode) => void) | null) {
  showPickerFn = fn;
}

export function showPicker(mode: OpenMode = "replace") {
  showPickerFn?.(mode);
}
