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
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { excerptAround, findExcerpt } from "../lib/excerpt";
import { imageFileFromList, insertAt, isAllowedImage } from "../lib/images";
import { api, type NoteMeta } from "../api";
import { matchSlashCommands, type SlashCommand } from "../lib/commands";
import { buildPageItems, completeTag, completeWiki, detectTrigger } from "../lib/suggest";
import type { TagSuggest } from "../api";

export type RemoteCaret = { id: string; from: number; to: number };

const props = defineProps<{
  modelValue: string;
  disabled?: boolean;
  remotes?: RemoteCaret[];
  showContext?: boolean;
  contextOrdinals?: number[];
  noteId?: string;
  title?: string;
  folder?: string;
  tags?: string[];
}>();
const emit = defineEmits<{
  "update:modelValue": [value: string];
  "live-change": [change: { from: number; to: number; insert: string; content: string }];
  cursor: [pos: { from: number; to: number }];
  "paragraph-commit": [payload: { ordinal: number; text: string }];
  "paragraph-leave": [payload: { ordinal: number; text: string }];
  "select-paragraph": [ordinal: number];
  tag: [name: string];
}>();

type MenuItem =
  | { kind: "command"; command: SlashCommand }
  | { kind: "note"; note: NoteMeta; path: string }
  | { kind: "create"; path: string; draft: { title: string; folder: string } }
  | { kind: "tag"; tag: TagSuggest };

const host = ref<HTMLDivElement | null>(null);
const menu = ref<{
  mode: "command" | "page" | "tag";
  from: number;
  query: string;
  items: MenuItem[];
} | null>(null);
const selected = ref(0);
const menuEl = ref<HTMLDivElement | null>(null);
const menuPos = ref({ top: 0, left: 0 });
let view: EditorView | null = null;
let searchTimer: number | undefined;
let searchId = 0;
let dirtyLine = -1;

const remoteAnn = Annotation.define<boolean>();
const setRemotes = StateEffect.define<RemoteCaret[]>();

class CaretWidget extends WidgetType {
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-remote-caret";
    return el;
  }
}

const setContextLines = StateEffect.define<number[]>();
const contextField = StateField.define<number[]>({
  create: () => [],
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setContextLines)) return effect.value;
    }
    return value;
  },
});

const contextPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = contextDecos(view.state);
    }
    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.transactions.some((tr) => tr.effects.some((e) => e.is(setContextLines)))
      ) {
        this.decorations = contextDecos(update.state);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

function contextDecos(state: EditorState): DecorationSet {
  const ords = state.field(contextField);
  if (!ords.length) return Decoration.none;
  const decos = [];
  for (const ord of ords) {
    const lineNo = ord + 1;
    if (lineNo < 1 || lineNo > state.doc.lines) continue;
    const line = state.doc.line(lineNo);
    decos.push(Decoration.line({ class: "cm-context-line" }).range(line.from));
  }
  return Decoration.set(decos, true);
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

function placeMenu(from: number, measured = false) {
  if (!view) return;
  const coords = view.coordsAtPos(from);
  if (!coords) return;
  const pad = 8;
  const gap = 6;
  const width = menuEl.value?.offsetWidth || 240;
  const height = menuEl.value?.offsetHeight || 0;
  const left = Math.min(Math.max(pad, coords.left), window.innerWidth - width - pad);
  let top = coords.bottom + gap;
  if (height && top + height + pad > window.innerHeight) {
    top = Math.max(pad, coords.top - height - gap);
  }
  menuPos.value = { top, left };
  if (!height && !measured) void nextTick(() => placeMenu(from, true));
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

function setTagMenu(from: number, query: string, hits: TagSuggest[]) {
  const items: MenuItem[] = hits.map((tag) => ({ kind: "tag" as const, tag }));
  if (!items.length) {
    closeMenu();
    return;
  }
  menu.value = { mode: "tag", from, query, items };
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
  if (item.kind === "tag") {
    replaceRange(current.from, completeTag(item.tag.name));
    emit("tag", item.tag.name);
    closeMenu();
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
  if (trigger.mode === "tag") {
    searchTimer = window.setTimeout(async () => {
      const doc = view?.state.doc.toString() ?? "";
      const hits = await api
        .suggestTags({
          note_id: props.noteId,
          q: trigger.query,
          title: props.title,
          folder: props.folder,
          content: doc,
          cursor: view?.state.selection.main.head,
          current_tags: props.tags,
        })
        .catch(() => []);
      if (id !== searchId || !view) return;
      const still = detectTrigger(view.state.doc.toString(), view.state.selection.main.head);
      if (!still || still.mode !== "tag") return;
      setTagMenu(still.from, still.query, hits);
    }, 120);
    return;
  }
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

function insertMarkdown(markdown: string) {
  if (!view) return;
  setDoc(insertAt(view.state.doc.toString(), view.state.selection.main.head, markdown));
  view.focus();
}

async function handleImage(file: File | null) {
  if (!file || !isAllowedImage(file) || !view) return;
  const asset = await api.uploadAsset(file);
  insertMarkdown(asset.markdown);
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
        contextField,
        contextPlugin,
        flashField,
        EditorView.updateListener.of((update) => {
          const remote = update.transactions.some((tr) => tr.annotation(remoteAnn));
          if (update.docChanged) {
            const content = update.state.doc.toString();
            emit("update:modelValue", content);
            if (!remote) {
              let sent = false;
              update.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
                const insert = inserted.toString();
                if (insert === "\n" && fromA === toA) {
                  const line = update.startState.doc.lineAt(fromA);
                  if (line.text.trim()) {
                    emit("paragraph-commit", { ordinal: line.number - 1, text: line.text });
                  }
                  dirtyLine = -1;
                } else {
                  dirtyLine = update.startState.doc.lineAt(fromA).number;
                }
                if (sent) return;
                sent = true;
                emit("live-change", { from: fromA, to: toA, insert, content });
              });
            }
          }
          if ((update.docChanged || update.selectionSet) && !remote) {
            void syncMenu();
          }
          if (update.selectionSet && !remote) {
            const sel = update.state.selection.main;
            emit("cursor", { from: sel.from, to: sel.to });
            const lineNo = update.state.doc.lineAt(sel.head).number;
            if (dirtyLine > 0 && lineNo !== dirtyLine) {
              const line = update.state.doc.line(Math.min(dirtyLine, update.state.doc.lines));
              if (line.text.trim()) {
                emit("paragraph-leave", { ordinal: line.number - 1, text: line.text });
              }
              dirtyLine = -1;
            }
          }
        }),
        EditorView.domEventHandlers({
          mousedown(event, vw) {
            if (!props.showContext) return false;
            const pos = vw.posAtCoords({ x: event.clientX, y: event.clientY });
            if (pos == null) return false;
            emit("select-paragraph", vw.state.doc.lineAt(pos).number - 1);
            return false;
          },
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
          ".cm-context-line": { boxShadow: "inset -2px 0 0 var(--accent)" },
          ".cm-placeholder": { color: "var(--text-muted)" },
          "&.cm-focused": { outline: "none" },
        }),
      ],
    }),
  });
  if (props.remotes?.length) {
    view.dispatch({ effects: setRemotes.of(props.remotes) });
  }
  if (props.contextOrdinals?.length) {
    view.dispatch({ effects: setContextLines.of(props.contextOrdinals) });
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

watch(
  () => props.contextOrdinals,
  (ords) => {
    view?.dispatch({ effects: setContextLines.of(ords ?? []) });
  },
);

function excerpt(): string {
  if (!view) return "";
  const sel = view.state.selection.main;
  return excerptAround(view.state.doc.toString(), sel.from, sel.to);
}

function currentOrdinal(): number {
  if (!view) return 0;
  return view.state.doc.lineAt(view.state.selection.main.head).number - 1;
}

function lineCoords(ordinal: number): { top: number; bottom: number; left: number } | null {
  if (!view) return null;
  const lineNo = ordinal + 1;
  if (lineNo < 1 || lineNo > view.state.doc.lines) return null;
  const coords = view.coordsAtPos(view.state.doc.line(lineNo).from);
  if (!coords) return null;
  return { top: coords.top, bottom: coords.bottom, left: coords.left };
}

function revealRange(from: number, to: number): boolean {
  if (!view) return false;
  const len = view.state.doc.length;
  const start = Math.max(0, Math.min(from, len));
  const end = Math.max(start, Math.min(to, len));
  view.dispatch({
    selection: { anchor: start, head: end },
    effects: [setFlash.of({ from: start, to: end }), EditorView.scrollIntoView(start, { y: "center" })],
  });
  window.setTimeout(() => {
    view?.dispatch({ effects: setFlash.of(null) });
  }, 1600);
  return true;
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

defineExpose({ excerpt, revealExcerpt, revealRange, currentOrdinal, lineCoords, insertMarkdown });

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
      ref="menuEl"
      class="suggest-menu"
      data-testid="suggest"
      role="listbox"
      :style="{ top: `${menuPos.top}px`, left: `${menuPos.left}px` }"
    >
      <button
        v-for="(item, index) in menu.items"
        :key="item.kind === 'command' ? item.command.id : item.kind === 'note' ? item.note.id : item.kind === 'tag' ? item.tag.name : 'create'"
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
        <template v-else-if="item.kind === 'tag'">
          <span>#{{ item.tag.name }}</span>
          <small :class="{ 'suggest-new': item.tag.create }">{{ item.tag.create ? "New" : item.tag.count }}</small>
        </template>
        <template v-else>
          <span>Create “{{ item.path }}”</span>
          <small class="suggest-new">New</small>
        </template>
      </button>
    </div>
  </Teleport>
</template>
