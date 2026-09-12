<script setup lang="ts">
import { computed } from "vue";
import { beginPendingAdd, pendingAdd, showPicker, splitTabs, type Pane, type PaneId, type Tab } from "../workspace";
import NavIcon from "./NavIcon.vue";

const props = defineProps<{
  pane: Pane;
  paneId: PaneId;
  focused: boolean;
}>();

const emit = defineEmits<{
  select: [id: string];
  close: [id: string];
  pin: [tab: Tab];
}>();

const groups = computed(() => splitTabs(props.pane));
const pending = computed(() => pendingAdd.value === props.paneId);

function label(tab: Tab) {
  return tab.title || tab.id;
}

function addTab() {
  beginPendingAdd(props.paneId);
  showPicker("add");
}
</script>

<template>
  <div class="tab-strip" data-testid="tab-strip" :class="{ focused }" role="tablist">
    <div class="tab-strip-scroll">
      <template v-if="groups.pinned.length">
        <button
          v-for="tab in groups.pinned"
          :key="tab.id"
          type="button"
          class="tab-chip pinned"
          role="tab"
          :class="{ active: !pending && tab.id === pane.active }"
          :aria-selected="!pending && tab.id === pane.active"
          :title="label(tab)"
          :data-testid="`tab-${tab.id}`"
          @click="emit('select', tab.id)"
        >
          <NavIcon name="tab" />
          <span
            class="tab-star"
            data-favorite="true"
            title="Unfavorite"
            data-testid="tab-star"
            @click.stop="emit('pin', tab)"
          >
            <NavIcon name="star" />
          </span>
          <span class="tab-title">{{ label(tab) }}</span>
          <span
            class="tab-close"
            title="Close"
            data-testid="tab-close"
            @click.stop="emit('close', tab.id)"
          >
            <NavIcon name="close" />
          </span>
        </button>
        <span v-if="groups.rest.length" class="tab-split" aria-hidden="true" />
      </template>
      <button
        v-for="tab in groups.rest"
        :key="tab.id"
        type="button"
        class="tab-chip"
        role="tab"
        :class="{ active: !pending && tab.id === pane.active }"
        :aria-selected="!pending && tab.id === pane.active"
        :title="label(tab)"
        :data-testid="`tab-${tab.id}`"
        @click="emit('select', tab.id)"
      >
        <NavIcon name="tab" />
        <span
          class="tab-star"
          title="Favorite"
          data-testid="tab-star"
          @click.stop="emit('pin', tab)"
        >
          <NavIcon name="star" />
        </span>
        <span class="tab-title">{{ label(tab) }}</span>
        <span
          class="tab-close"
          title="Close"
          data-testid="tab-close"
          @click.stop="emit('close', tab.id)"
        >
          <NavIcon name="close" />
        </span>
      </button>
      <Transition name="tab-pending">
        <span v-if="pending" class="tab-pending-wrap">
          <button
            type="button"
            class="tab-chip pending active"
            role="tab"
            aria-selected="true"
            aria-label="New tab"
            data-testid="tab-pending"
            tabindex="-1"
          >
            <NavIcon name="tab" />
          </button>
        </span>
      </Transition>
      <button type="button" class="tab-add" data-testid="tab-add" title="Open in new tab" aria-label="Open in new tab" @click="addTab">
        <NavIcon name="addTab" />
      </button>
    </div>
  </div>
</template>
