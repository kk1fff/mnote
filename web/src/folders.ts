import { ref } from "vue";
import { api } from "./api";

export const collapsed = ref(new Set<string>());

export async function refreshCollapsed() {
  collapsed.value = new Set(await api.collapsedFolders());
}

export function resetCollapsed() {
  collapsed.value = new Set();
}

export async function toggleCollapsed(path: string) {
  const next = new Set(collapsed.value);
  const closing = !next.has(path);
  if (closing) next.add(path);
  else next.delete(path);
  collapsed.value = next;
  try {
    if (closing) await api.collapseFolder(path);
    else await api.expandFolder(path);
  } catch {
    const revert = new Set(collapsed.value);
    if (closing) revert.delete(path);
    else revert.add(path);
    collapsed.value = revert;
  }
}
