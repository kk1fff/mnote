<script setup lang="ts">
import type { NoteMeta } from "../api";
import { noteHref } from "../lib/paths";
import type { TreeNode } from "../lib/tree";
import NoteTree from "./NoteTree.vue";

defineProps<{
  nodes: TreeNode[];
  activeIds: string[];
  collapsed: Set<string>;
  menuId: string;
}>();

const emit = defineEmits<{
  toggle: [path: string];
  menu: [note: NoteMeta, event: MouseEvent];
  open: [id: string, event: MouseEvent];
}>();

function onOpen(event: MouseEvent, id: string) {
  emit("open", id, event);
}
</script>

<template>
  <ul class="tree">
    <li v-for="node in nodes" :key="node.kind === 'folder' ? `f:${node.path}` : node.note.id">
      <template v-if="node.kind === 'folder'">
        <button type="button" class="linkish folder" @click="emit('toggle', node.path)">
          {{ collapsed.has(node.path) ? "▸" : "▾" }} {{ node.name }}
        </button>
        <NoteTree
          v-if="!collapsed.has(node.path)"
          :nodes="node.children"
          :active-ids="activeIds"
          :collapsed="collapsed"
          :menu-id="menuId"
          @toggle="emit('toggle', $event)"
          @menu="(note, event) => emit('menu', note, event)"
          @open="(id, event) => emit('open', id, event)"
        />
      </template>
      <div
        v-else
        class="tree-row"
        :class="{ active: activeIds.includes(node.note.id), open: menuId === node.note.id }"
      >
        <RouterLink
          class="tree-link"
          :to="noteHref(node.note.id)"
          :class="{ active: activeIds.includes(node.note.id) }"
          @click="onOpen($event, node.note.id)"
        >
          {{ node.name }}
        </RouterLink>
        <button
          type="button"
          class="tree-more"
          :aria-label="`Actions for ${node.name}`"
          :aria-expanded="menuId === node.note.id"
          data-testid="tree-more"
          @click.stop="emit('menu', node.note, $event)"
        >
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <circle cx="3.5" cy="8" r="1.2" fill="currentColor" />
            <circle cx="8" cy="8" r="1.2" fill="currentColor" />
            <circle cx="12.5" cy="8" r="1.2" fill="currentColor" />
          </svg>
        </button>
      </div>
    </li>
  </ul>
</template>
