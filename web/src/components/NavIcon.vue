<script setup lang="ts">
import { computed } from "vue";

export type IconName =
  | "search"
  | "plus"
  | "inbox"
  | "note"
  | "notes"
  | "journal"
  | "image"
  | "images"
  | "star"
  | "favorites"
  | "tag"
  | "tags"
  | "calendar"
  | "link"
  | "backlinks"
  | "history"
  | "more"
  | "gear"
  | "settings"
  | "panelClose"
  | "panelOpen"
  | "chevronRight"
  | "chevronLeft"
  | "chevronDown"
  | "menu"
  | "trash"
  | "edit"
  | "preview"
  | "splitView"
  | "lightMode"
  | "darkMode"
  | "user"
  | "tab"
  | "addTab"
  | "attachment"
  | "duplicate"
  | "move"
  | "rename"
  | "collapse";

const FILES: Partial<Record<IconName, string>> = {
  search: "search",
  plus: "new-note",
  inbox: "inbox",
  note: "note",
  notes: "notes",
  journal: "journal",
  image: "image",
  images: "images",
  star: "favorites",
  favorites: "favorites",
  tag: "tags",
  tags: "tags",
  calendar: "calendar",
  link: "link",
  backlinks: "backlinks",
  more: "more",
  gear: "settings",
  settings: "settings",
  panelClose: "sidebar-close",
  panelOpen: "sidebar-open",
  chevronRight: "chevron-right",
  chevronLeft: "chevron-right",
  chevronDown: "chevron-down",
  menu: "menu",
  trash: "trash",
  edit: "edit",
  preview: "preview",
  splitView: "split-view",
  lightMode: "light-mode",
  darkMode: "dark-mode",
  user: "user",
  tab: "tab",
  addTab: "add-tab",
  attachment: "attachment",
  duplicate: "duplicate",
  move: "move",
  rename: "rename",
  collapse: "collapse",
};

const modules = import.meta.glob("../icons/*.svg", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const HISTORY =
  '<path d="M3.25 3.5h4.1c1.2 0 2.15.95 2.15 2.15v6.6c0-.83-.67-1.5-1.5-1.5H3.25V3.5z" /><path d="M12.75 3.5H8.65c-1.2 0-2.15.95-2.15 2.15v6.6c0-.83.67-1.5 1.5-1.5h4.75V3.5z" />';

const props = defineProps<{ name: IconName }>();

const inner = computed(() => {
  if (props.name === "history") return HISTORY;
  const file = FILES[props.name];
  if (!file) return "";
  const needle = `/icons/${file}.svg`;
  const raw = Object.entries(modules).find(([key]) => key.replaceAll("\\", "/").endsWith(needle))?.[1];
  if (!raw) return "";
  return raw.replace(/^[\s\S]*?<svg[^>]*>/i, "").replace(/<\/svg>\s*$/i, "").trim();
});
</script>

<template>
  <svg
    class="nav-icon"
    :class="{ 'is-flip': name === 'chevronLeft' }"
    :viewBox="name === 'history' ? '0 0 16 16' : '0 0 24 24'"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    :stroke-width="name === 'history' ? 1.5 : 1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    v-html="inner"
  />
</template>
