<script setup lang="ts">
import { computed } from "vue";
import { showPicker, splitTabs, type Pane, type Tab } from "../workspace";

const props = defineProps<{
  pane: Pane;
  focused: boolean;
}>();

const emit = defineEmits<{
  select: [id: string];
  close: [id: string];
  pin: [tab: Tab];
}>();

const groups = computed(() => splitTabs(props.pane));

function label(tab: Tab) {
  return tab.title || tab.id;
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
          :class="{ active: tab.id === pane.active }"
          :aria-selected="tab.id === pane.active"
          :title="label(tab)"
          :data-testid="`tab-${tab.id}`"
          @click="emit('select', tab.id)"
        >
          <span
            class="tab-star"
            title="Unfavorite"
            data-testid="tab-star"
            @click.stop="emit('pin', tab)"
          >
            ★
          </span>
          <span class="tab-title">{{ label(tab) }}</span>
          <span
            class="tab-close"
            title="Close"
            data-testid="tab-close"
            @click.stop="emit('close', tab.id)"
          >
            ×
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
        :class="{ active: tab.id === pane.active }"
        :aria-selected="tab.id === pane.active"
        :title="label(tab)"
        :data-testid="`tab-${tab.id}`"
        @click="emit('select', tab.id)"
      >
        <span
          class="tab-star"
          title="Favorite"
          data-testid="tab-star"
          @click.stop="emit('pin', tab)"
        >
          ★
        </span>
        <span class="tab-title">{{ label(tab) }}</span>
        <span
          class="tab-close"
          title="Close"
          data-testid="tab-close"
          @click.stop="emit('close', tab.id)"
        >
          ×
        </span>
      </button>
    </div>
    <button type="button" class="tab-add" data-testid="tab-add" title="Go to…" aria-label="Go to…" @click="showPicker()">
      +
    </button>
  </div>
</template>
