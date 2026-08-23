<script setup lang="ts">
import { Annotation, EditorState, Prec, StateEffect, StateField } from "@codemirror/state";
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
import { api, type NoteMeta } from "../api";
import { matchSlashCommands, type SlashCommand } from "../lib/commands";
import { buildPageItems, completeWiki, detectTrigger } from "../lib/suggest";

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

type MenuItem =
  | { kind: "command"; command: SlashCommand }
  | { kind: "note"; note: NoteMeta; path: string }
  | { kind: "create"; path: string; draft: { title: string; folder: string } };

const host = ref<HTMLDivElement | null>(null);
const menu = ref<{ mode: "command" | "page"; from: number; query: string; items: MenuItem[] } | null>(
  null,
);
const selected = ref(0);
const menuPos = ref({ top: 0, left: 0 });
let view: EditorView | null = null;
let searchTimer: number | undefined;
let searchId = 0;

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

function placeMenu(from: number) {
  if (!view) return;
  const coords = view.coordsAtPos(from);
  if (!coords) return;
  const pad = 8;
  const width = 240;
  const left = Math.min(Math.max(pad, coords.left), window.innerWidth - width - pad);
  let top = coords.bottom + 6;
  if (top + 220 > window.innerHeight) top = Math.max(pad, coords.top - 226);
  menuPos.value = { top, left };
}

function closeMenu() {
  menu.value = null;
  window.clearTimeout(searchTimer);
}

function setCommandMenu(from: number, query: string) {
  const items = matchSlashCommands(query).map((command) => ({ kind: "command" as const, command }));
  if (!items.length) {
    closeMenu();
    return;
  }
  menu.value = { mode: "command", from, query, items };
  selected.value = 0;
  placeMenu(from);
}

function setPageMenu(from: number, query: string, notes: NoteMeta[]) {
  const items: MenuItem[] = buildPageItems(query, notes).map((item) =>
    item.type === "note"
      ? { kind: "note" as const, note: item.note, path: item.path }
      : { kind: "create" as const, path: item.path, draft: item.draft },
  );
  if (!items.length) {
    closeMenu();
    return;
  }
  menu.value = { mode: "page", from, query, items };
  selected.value = 0;
  placeMenu(from);
}

function replaceRange(from: number, text: string) {
  if (!view) return;
  const to = view.state.selection.main.head;
  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + text.length },
  });
  view.focus();
}

function startPageLink(query: string) {
  const from = menu.value?.from ?? 0;
  replaceRange(from, `[[${query}`);
}

function accept(index = selected.value) {
  const current = menu.value;
  const item = current?.items[index];
  if (!current || !item) return;
  if (item.kind === "command") {
    item.command.run({
      query: current.query,
      replace: (text) => replaceRange(current.from, text),
      startPageLink,
    });
    if (item.command.id !== "page") closeMenu();
    return;
  }
  replaceRange(current.from, completeWiki(item.path));
  closeMenu();
}

async function syncMenu() {
  if (!view) return;
  const trigger = detectTrigger(view.state.doc.toString(), view.state.selection.main.head);
  if (!trigger) {
    closeMenu();
    return;
  }
  if (trigger.mode === "command") {
    window.clearTimeout(searchTimer);
    setCommandMenu(trigger.from, trigger.query);
    return;
  }
  const id = ++searchId;
  window.clearTimeout(searchTimer);
  if (trigger.query.trim()) setPageMenu(trigger.from, trigger.query, []);
  searchTimer = window.setTimeout(async () => {
    const notes = trigger.query.trim()
      ? await api.titleSearch(trigger.query).catch(() => [])
      : await api.recentNotes().catch(() => []);
    if (id !== searchId || !view) return;
    const still = detectTrigger(view.state.doc.toString(), view.state.selection.main.head);
    if (!still || still.mode !== "page") return;
    setPageMenu(still.from, still.query, notes);
  }, 120);
}

function onMenuKey(key: string): boolean {
  if (!menu.value?.items.length) return false;
  if (key === "ArrowDown") {
    selected.value = (selected.value + 1) % menu.value.items.length;
    return true;
  }
  if (key === "ArrowUp") {
    selected.value = (selected.value - 1 + menu.value.items.length) % menu.value.items.length;
    return true;
  }
  if (key === "Enter" || key === "Tab") {
    accept();
    return true;
  }
  if (key === "Escape") {
    closeMenu();
    return true;
  }
  return false;
}

function onDocClick(event: MouseEvent) {
  const el = event.target;
  if (!(el instanceof Node)) return;
  if (host.value?.contains(el)) return;
  if (el instanceof Element && el.closest(".suggest-menu")) return;
  closeMenu();
}

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
        Prec.highest(
          keymap.of([
            { key: "ArrowDown", run: () => onMenuKey("ArrowDown") },
            { key: "ArrowUp", run: () => onMenuKey("ArrowUp") },
            { key: "Enter", run: () => onMenuKey("Enter") },
            { key: "Tab", run: () => onMenuKey("Tab") },
            { key: "Escape", run: () => onMenuKey("Escape") },
          ]),
        ),
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
          if ((update.docChanged || update.selectionSet) && !remote) {
            void syncMenu();
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
          "&": {
            height: "100%",
            fontSize: "16px",
            backgroundColor: "transparent",
            color: "var(--text)",
          },
          ".cm-scroller": { fontFamily: "var(--font-mono)" },
          ".cm-content": {
            padding: "1.1rem 1.25rem 2rem",
            caretColor: "var(--text)",
            color: "var(--text)",
          },
          ".cm-line": { color: "var(--text)" },
          ".cm-placeholder": { color: "var(--text-muted)" },
          "&.cm-focused": { outline: "none" },
        }),
      ],
    }),
  });
  if (props.remotes?.length) {
    view.dispatch({ effects: setRemotes.of(props.remotes) });
  }
  document.addEventListener("mousedown", onDocClick);
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
  document.removeEventListener("mousedown", onDocClick);
  closeMenu();
  view?.destroy();
  view = null;
});
</script>

<template>
  <div ref="host" class="editor" data-testid="editor" />
  <Teleport to="body">
    <div
      v-if="menu"
      class="suggest-menu"
      data-testid="suggest"
      role="listbox"
      :style="{ top: `${menuPos.top}px`, left: `${menuPos.left}px` }"
    >
      <button
        v-for="(item, index) in menu.items"
        :key="item.kind === 'command' ? item.command.id : item.kind === 'note' ? item.note.id : 'create'"
        type="button"
        :class="{ active: selected === index }"
        role="option"
        :aria-selected="selected === index"
        @mousedown.prevent="accept(index)"
      >
        <template v-if="item.kind === 'command'">
          <span>{{ item.command.title }}</span>
          <small>{{ item.command.hint }}</small>
        </template>
        <template v-else-if="item.kind === 'note'">
          <span>{{ item.note.title }}</span>
          <small>{{ item.note.folder }}</small>
        </template>
        <template v-else>
          <span>Create “{{ item.path }}”</span>
          <small class="suggest-new">New</small>
        </template>
      </button>
    </div>
  </Teleport>
</template>
