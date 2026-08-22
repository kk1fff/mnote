<script setup lang="ts">
import { noteHref } from "../lib/paths";
import type { TreeNode } from "../lib/tree";
import NoteTree from "./NoteTree.vue";

defineProps<{
  nodes: TreeNode[];
  activeId: string;
  collapsed: Set<string>;
}>();

const emit = defineEmits<{
  toggle: [path: string];
}>();
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
          :active-id="activeId"
          :collapsed="collapsed"
          @toggle="emit('toggle', $event)"
        />
      </template>
      <RouterLink
        v-else
        :to="noteHref(node.note.id)"
        :class="{ active: activeId === node.note.id }"
      >
        {{ node.name }}
      </RouterLink>
    </li>
  </ul>
</template>
