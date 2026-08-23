<script setup lang="ts">
import { Annotation, EditorState, StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  placeholder,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { defineExpose, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { excerptAround, findExcerpt } from "../lib/excerpt";
import { imageFileFromList, insertAt, isAllowedImage } from "../lib/images";
import { api } from "../api";

export type RemoteCaret = { id: string; from: number; to: number };

const props = defineProps<{
  modelValue: string;
  disabled?: boolean;
  remotes?: RemoteCaret[];
}>();
const emit = defineEmits<{
  "update:modelValue": [value: string];
  "live-change": [change: { from: number; to: number; insert: string; content: string }];
  cursor: [pos: { from: number; to: number }];
}>();

const host = ref<HTMLDivElement | null>(null);
let view: EditorView | null = null;

const remoteAnn = Annotation.define<boolean>();
const setRemotes = StateEffect.define<RemoteCaret[]>();

class CaretWidget extends WidgetType {
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-remote-caret";
    return el;
  }
}

const setFlash = StateEffect.define<{ from: number; to: number } | null>();
const flashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setFlash)) {
        if (!effect.value) return Decoration.none;
        return Decoration.set([
          Decoration.mark({ class: "cm-park-excerpt" }).range(effect.value.from, effect.value.to),
        ]);
      }
    }
    return value.map(tr.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

const remotesField = StateField.define<RemoteCaret[]>({
  create: () => [],
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setRemotes)) return effect.value;
    }
    return value;
  },
});

function remoteDecos(state: EditorState): DecorationSet {
  const remotes = state.field(remotesField);
  const decos = [];
  const len = state.doc.length;
  for (const remote of remotes) {
    const from = Math.max(0, Math.min(remote.from, len));
    const to = Math.max(0, Math.min(remote.to, len));
    const start = Math.min(from, to);
    const end = Math.max(from, to);
    if (end > start) {
      decos.push(Decoration.mark({ class: "cm-remote-sel" }).range(start, end));
    }
    decos.push(Decoration.widget({ widget: new CaretWidget(), side: 1 }).range(end));
  }
  return Decoration.set(decos, true);
}

const remotesPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = remoteDecos(view.state);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.transactions.some((tr) => tr.effects.some((e) => e.is(setRemotes)))) {
        this.decorations = remoteDecos(update.state);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

function setDoc(text: string, remote = false) {
  if (!view || view.state.doc.toString() === text) return;
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
    annotations: remote ? [remoteAnn.of(true)] : undefined,
  });
}

async function handleImage(file: File | null) {
  if (!file || !isAllowedImage(file) || !view) return;
  const asset = await api.uploadAsset(file);
  const pos = view.state.selection.main.head;
  const next = insertAt(view.state.doc.toString(), pos, asset.markdown);
  setDoc(next);
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
        remotesField,
        remotesPlugin,
        flashField,
        EditorView.updateListener.of((update) => {
          const remote = update.transactions.some((tr) => tr.annotation(remoteAnn));
          if (update.docChanged) {
            const content = update.state.doc.toString();
            emit("update:modelValue", content);
            if (!remote) {
              let sent = false;
              update.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
                if (sent) return;
                sent = true;
                emit("live-change", { from: fromA, to: toA, insert: inserted.toString(), content });
              });
            }
          }
          if (update.selectionSet && !remote) {
            const sel = update.state.selection.main;
            emit("cursor", { from: sel.from, to: sel.to });
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
  if (props.remotes?.length) {
    view.dispatch({ effects: setRemotes.of(props.remotes) });
  }
});

watch(
  () => props.modelValue,
  (value) => setDoc(value, true),
);

watch(
  () => props.remotes,
  (remotes) => {
    view?.dispatch({ effects: setRemotes.of(remotes ?? []) });
  },
);

function excerpt(): string {
  if (!view) return "";
  const sel = view.state.selection.main;
  return excerptAround(view.state.doc.toString(), sel.from, sel.to);
}

function revealExcerpt(quote: string): boolean {
  if (!view) return false;
  const found = findExcerpt(view.state.doc.toString(), quote);
  if (!found) return false;
  view.dispatch({
    selection: { anchor: found.from, head: found.to },
    effects: [
      setFlash.of(found),
      EditorView.scrollIntoView(found.from, { y: "center" }),
    ],
  });
  window.setTimeout(() => {
    view?.dispatch({ effects: setFlash.of(null) });
  }, 1600);
  return true;
}

defineExpose({ excerpt, revealExcerpt });

onBeforeUnmount(() => {
  view?.destroy();
  view = null;
});
</script>

<template>
  <div ref="host" class="editor" data-testid="editor" />
</template>
