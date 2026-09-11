<script setup lang="ts">
import type { NoteMeta } from "../api";
import { noteHref } from "../lib/paths";
import type { TreeNode } from "../lib/tree";
import NavIcon from "./NavIcon.vue";
import NoteTree from "./NoteTree.vue";
import SidebarFold from "./SidebarFold.vue";

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
        <button
          type="button"
          class="linkish folder"
          data-testid="tree-folder"
          :aria-expanded="!collapsed.has(node.path)"
          @click="emit('toggle', node.path)"
        >
          <span class="fold-chevron" :class="{ folded: collapsed.has(node.path) }" aria-hidden="true"><NavIcon name="chevronDown" /></span>
          <span class="folder-name">{{ node.name }}</span>
        </button>
        <SidebarFold :open="!collapsed.has(node.path)">
          <NoteTree
            :nodes="node.children"
            :active-ids="activeIds"
            :collapsed="collapsed"
            :menu-id="menuId"
            @toggle="emit('toggle', $event)"
            @menu="(note, event) => emit('menu', note, event)"
            @open="(id, event) => emit('open', id, event)"
          />
        </SidebarFold>
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
          <NavIcon name="note" /><span>{{ node.name }}</span>
        </RouterLink>
        <button
          type="button"
          class="tree-more"
          :aria-label="`Actions for ${node.name}`"
          :aria-expanded="menuId === node.note.id"
          data-testid="tree-more"
          @click.stop="emit('menu', node.note, $event)"
        >
          <NavIcon name="more" />
        </button>
      </div>
    </li>
  </ul>
</template>
