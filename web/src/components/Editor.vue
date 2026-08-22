<script setup lang="ts">
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { imageFileFromList, insertAt, isAllowedImage } from "../lib/images";
import { api } from "../api";

const props = defineProps<{ modelValue: string; disabled?: boolean }>();
const emit = defineEmits<{
  "update:modelValue": [value: string];
}>();

const host = ref<HTMLDivElement | null>(null);
let view: EditorView | null = null;

function setDoc(text: string) {
  if (!view || view.state.doc.toString() === text) return;
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
  });
}

async function handleImage(file: File | null) {
  if (!file || !isAllowedImage(file) || !view) return;
  const asset = await api.uploadAsset(file);
  const pos = view.state.selection.main.head;
  const next = insertAt(view.state.doc.toString(), pos, asset.markdown);
  setDoc(next);
  emit("update:modelValue", next);
}

onMounted(() => {
  if (!host.value) return;
  view = new EditorView({
    parent: host.value,
    state: EditorState.create({
      doc: props.modelValue,
      extensions: [
        history(),
        markdown(),
        placeholder("Write…"),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            emit("update:modelValue", update.state.doc.toString());
          }
        }),
        EditorView.domEventHandlers({
          paste(event) {
            const file = imageFileFromList(event.clipboardData?.items ?? []);
            if (!file) return false;
            event.preventDefault();
            void handleImage(file);
            return true;
          },
          drop(event) {
            const file = event.dataTransfer?.files?.[0] ?? null;
            if (!file || !isAllowedImage(file)) return false;
            event.preventDefault();
            void handleImage(file);
            return true;
          },
        }),
        EditorView.editable.of(!props.disabled),
        EditorView.theme({
          "&": { height: "100%", fontSize: "16px" },
          ".cm-scroller": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" },
          ".cm-content": { padding: "16px 12px" },
          "&.cm-focused": { outline: "none" },
        }),
      ],
    }),
  });
});

watch(
  () => props.modelValue,
  (value) => setDoc(value),
);

onBeforeUnmount(() => {
  view?.destroy();
  view = null;
});
</script>

<template>
  <div ref="host" class="editor" />
</template>
