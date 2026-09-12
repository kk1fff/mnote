<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { renderTableCell } from "../lib/markdown";
import {
  cloneTable, columnLabel, deleteColumns, deleteRows, insertColumn, insertRow,
  moveColumn, moveRow, pasteCells, readTable, sortRows, writeTable,
  type Cell, type TableDraft,
} from "../lib/table-editor";

const props = defineProps<{ source: string; conflict: boolean; disabled?: boolean; conflictMessage?: string }>();
const emit = defineEmits<{ cancel: []; apply: [source: string]; reload: [] }>();
const initial = readTable(props.source);
const draft = ref(cloneTable(initial));
const active = ref<Cell>({ row: 0, col: 0 });
const anchor = ref<Cell>({ row: 0, col: 0 });
const selectionKind = ref<"cells" | "rows" | "columns">("cells");
const editing = ref(false);
const editValue = ref("");
const dialog = ref<HTMLDialogElement | null>(null);
const menu = ref<"actions" | "row" | "column" | "align" | "sort" | "more" | null>(null);
const sortColumn = ref(0);
const sortMode = ref<"auto" | "text" | "number">("auto");
const sortDirection = ref<"asc" | "desc">("asc");
const message = ref("");
const media = window.matchMedia("(max-width: 700px)");
const mobile = ref(media.matches);
const viewportHeight = ref(window.visualViewport?.height ?? window.innerHeight);
const viewportTop = ref(window.visualViewport?.offsetTop ?? 0);
type Snapshot = { table: TableDraft; active: Cell; anchor: Cell };
const past = ref<Snapshot[]>([]);
const future = ref<Snapshot[]>([]);
const bounds = computed(() => ({
  top: Math.min(active.value.row, anchor.value.row), bottom: Math.max(active.value.row, anchor.value.row),
  left: Math.min(active.value.col, anchor.value.col), right: Math.max(active.value.col, anchor.value.col),
}));
const address = computed(() => `${columnLabel(active.value.col)}${active.value.row === 0 ? " · Header" : active.value.row}`);
const changed = computed(() => JSON.stringify(draft.value) !== JSON.stringify(initial));
const allColumns = computed(() => bounds.value.right - bounds.value.left + 1 === draft.value.align.length);

function snapshot(): Snapshot { return { table: cloneTable(draft.value), active: { ...active.value }, anchor: { ...anchor.value } }; }
function remember(before: Snapshot) {
  if (JSON.stringify(before.table) === JSON.stringify(draft.value)) return;
  past.value.push(before);
  future.value = [];
}
function clamp() {
  for (const cell of [active.value, anchor.value]) {
    cell.row = Math.max(0, Math.min(cell.row, draft.value.cells.length - 1));
    cell.col = Math.max(0, Math.min(cell.col, draft.value.align.length - 1));
  }
}
function commit() {
  if (!editing.value) return;
  const before = snapshot();
  draft.value.cells[active.value.row][active.value.col] = editValue.value;
  editing.value = false;
  remember(before);
}
function change(fn: (table: TableDraft) => void) {
  commit();
  const before = snapshot();
  fn(draft.value);
  clamp();
  remember(before);
  menu.value = null;
  void focusCell();
}
async function focusCell() {
  await nextTick();
  const el = dialog.value?.querySelector<HTMLElement>(`[data-cell="${active.value.row}:${active.value.col}"]`);
  el?.focus({ preventScroll: true });
  el?.scrollIntoView({ block: "nearest", inline: "nearest" });
}
async function begin(replacement?: string) {
  menu.value = null;
  anchor.value = { ...active.value };
  selectionKind.value = "cells";
  editValue.value = replacement ?? draft.value.cells[active.value.row][active.value.col];
  editing.value = true;
  await nextTick();
  const input = dialog.value?.querySelector<HTMLTextAreaElement>("textarea[data-cell-input]");
  input?.focus();
  if (replacement === undefined) input?.select();
}
function select(row: number, col: number, extend = false) {
  commit();
  active.value = { row, col };
  if (!extend) anchor.value = { row, col };
  selectionKind.value = "cells";
  menu.value = null;
  if (mobile.value && !extend) void begin();
  else void focusCell();
}
function selectRow(row: number, extend = false) {
  commit();
  anchor.value = { row: extend && selectionKind.value === "rows" ? anchor.value.row : row, col: 0 };
  active.value = { row, col: draft.value.align.length - 1 };
  selectionKind.value = "rows";
  menu.value = "row";
}
function selectColumn(col: number, extend = false) {
  commit();
  anchor.value = { row: 0, col: extend && selectionKind.value === "columns" ? anchor.value.col : col };
  active.value = { row: draft.value.cells.length - 1, col };
  selectionKind.value = "columns";
  menu.value = "column";
}
function selected(row: number, col: number) {
  const b = bounds.value;
  return row >= b.top && row <= b.bottom && col >= b.left && col <= b.right;
}
function travel(delta: number) {
  commit();
  let index = active.value.row * draft.value.align.length + active.value.col + delta;
  if (index < 0) index = 0;
  if (index >= draft.value.cells.length * draft.value.align.length) change((t) => insertRow(t, t.cells.length));
  active.value = { row: Math.floor(index / draft.value.align.length), col: index % draft.value.align.length };
  anchor.value = { ...active.value };
  if (mobile.value) void begin(); else void focusCell();
}
function undo(redo = false) {
  commit();
  const stack = redo ? future : past;
  const item = stack.value.pop();
  if (!item) return;
  (redo ? past : future).value.push(snapshot());
  draft.value = cloneTable(item.table);
  active.value = { ...item.active }; anchor.value = { ...item.anchor };
  menu.value = null;
  void focusCell();
}
function clear() {
  const b = { ...bounds.value };
  change((t) => { for (let r = b.top; r <= b.bottom; r++) for (let c = b.left; c <= b.right; c++) t.cells[r][c] = ""; });
}
function copy(event: ClipboardEvent) {
  if (editing.value) return;
  const b = bounds.value;
  event.preventDefault();
  event.clipboardData?.setData("text/plain", draft.value.cells.slice(b.top, b.bottom + 1).map((r) => r.slice(b.left, b.right + 1).join("\t")).join("\n"));
}
function paste(event: ClipboardEvent) {
  const text = event.clipboardData?.getData("text/plain");
  if (text === undefined || (editing.value && !/[\t\r\n]/.test(text))) return;
  event.preventDefault();
  const start = { row: bounds.value.top, col: bounds.value.left };
  change((t) => { active.value = pasteCells(t, start, text); anchor.value = start; });
}
function apply() {
  commit();
  if (props.conflict || props.disabled) return;
  emit("apply", changed.value ? writeTable(draft.value) : props.source);
}
async function copyMarkdown() {
  commit();
  try { await navigator.clipboard.writeText(changed.value ? writeTable(draft.value) : props.source); message.value = "Table Markdown copied"; }
  catch { message.value = "Could not copy. Select cells and use your device’s Copy command."; }
}
function toggleMenu(value: typeof menu.value) {
  commit();
  menu.value = menu.value === value ? null : value;
  sortColumn.value = active.value.col;
}
function key(event: KeyboardEvent) {
  if (event.isComposing) return;
  const mod = event.metaKey || event.ctrlKey;
  if (event.key === "Escape") {
    event.preventDefault();
    if (menu.value) { menu.value = null; void focusCell(); }
    else if (editing.value) { editing.value = false; void focusCell(); }
    else emit("cancel");
    return;
  }
  if (mod && event.key === "Enter") { event.preventDefault(); apply(); return; }
  if (mod && (event.key.toLowerCase() === "z" || event.key.toLowerCase() === "y")) {
    event.preventDefault(); undo(event.shiftKey || event.key.toLowerCase() === "y"); return;
  }
  const target = event.target as HTMLElement;
  if (!target.closest("[data-cell], [data-cell-input]")) return;
  if (event.key === "Tab") {
    event.preventDefault();
    // Let keyboard users leave the grid and reach every tool without closing
    // their draft. Forward Tab still advances cells and appends at the end.
    if (event.shiftKey && active.value.row === 0 && active.value.col === 0) {
      commit();
      dialog.value?.querySelector<HTMLButtonElement>(".table-editor-toolbar button:last-of-type")?.focus();
    } else travel(event.shiftKey ? -1 : 1);
    return;
  }
  if (editing.value) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault(); commit();
      active.value.row = Math.min(active.value.row + 1, draft.value.cells.length - 1);
      anchor.value = { ...active.value }; void focusCell();
    }
    return;
  }
  if (event.key === "Enter" || event.key === "F2") { event.preventDefault(); void begin(); }
  else if (event.key.startsWith("Arrow")) {
    event.preventDefault();
    const row = Math.max(0, Math.min(draft.value.cells.length - 1, active.value.row + (event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0)));
    const col = Math.max(0, Math.min(draft.value.align.length - 1, active.value.col + (event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0)));
    select(row, col, event.shiftKey);
  } else if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); clear(); }
  else if (mod && event.key.toLowerCase() === "a") {
    event.preventDefault(); anchor.value = { row: 0, col: 0 }; active.value = { row: draft.value.cells.length - 1, col: draft.value.align.length - 1 };
  } else if (!mod && !event.altKey && event.key.length === 1) { event.preventDefault(); void begin(event.key); }
}
function resize() { commit(); mobile.value = media.matches; }
function resizeViewport() {
  viewportHeight.value = window.visualViewport?.height ?? window.innerHeight;
  viewportTop.value = window.visualViewport?.offsetTop ?? 0;
}
onMounted(() => {
  dialog.value?.showModal(); void focusCell(); media.addEventListener("change", resize);
  window.visualViewport?.addEventListener("resize", resizeViewport);
  window.visualViewport?.addEventListener("scroll", resizeViewport);
});
onBeforeUnmount(() => {
  media.removeEventListener("change", resize); dialog.value?.close();
  window.visualViewport?.removeEventListener("resize", resizeViewport);
  window.visualViewport?.removeEventListener("scroll", resizeViewport);
});
</script>

<template>
  <dialog ref="dialog" class="table-editor" data-testid="table-editor" aria-labelledby="table-editor-title" :style="mobile ? { height: `${viewportHeight}px`, top: `${viewportTop}px` } : undefined" @cancel.prevent @keydown.stop="key">
    <header class="table-editor-bar">
      <div><strong id="table-editor-title">Edit table</strong><small>{{ draft.cells.length - 1 }} rows · {{ draft.align.length }} columns</small></div>
      <div class="table-editor-actions"><button type="button" class="ghost" @click="emit('cancel')">Cancel</button><button type="button" :disabled="conflict || disabled" @click="apply">Apply</button></div>
    </header>
    <div class="table-editor-toolbar" aria-label="Table actions">
      <button type="button" class="ghost" @click="change(t => insertRow(t, active.row + 1))">+ Row</button>
      <button type="button" class="ghost" @click="change(t => insertColumn(t, active.col + 1))">+ Column</button>
      <button v-if="mobile" type="button" class="ghost" :aria-expanded="menu !== null" @click="toggleMenu('actions')">Actions ▾</button>
      <template v-else>
      <button type="button" class="ghost" :aria-expanded="menu === 'row'" @click="toggleMenu('row')">Row ▾</button>
      <button type="button" class="ghost" :aria-expanded="menu === 'column'" @click="toggleMenu('column')">Column ▾</button>
      <button type="button" class="ghost" :aria-expanded="menu === 'align'" @click="toggleMenu('align')">Align ▾</button>
      <button type="button" class="ghost" :aria-expanded="menu === 'sort'" @click="toggleMenu('sort')">Sort ▾</button>
      <span class="table-toolbar-spacer" />
      <button type="button" class="ghost" aria-label="Undo table change" :disabled="!past.length && !editing" @click="undo()">↶</button>
      <button type="button" class="ghost" aria-label="Redo table change" :disabled="!future.length" @click="undo(true)">↷</button>
      <button type="button" class="ghost" aria-label="More table actions" :aria-expanded="menu === 'more'" @click="toggleMenu('more')">⋯</button>
      </template>
    </div>
    <div class="table-menu-slot">
      <div v-if="menu" class="table-action-menu" data-testid="table-action-menu">
        <template v-if="menu === 'actions'">
          <strong>Table actions</strong>
          <button class="ghost" @click="toggleMenu('row')">Row ▾</button>
          <button class="ghost" @click="toggleMenu('column')">Column ▾</button>
          <button class="ghost" @click="toggleMenu('align')">Align ▾</button>
          <button class="ghost" @click="toggleMenu('sort')">Sort ▾</button>
          <button class="ghost" :disabled="!past.length" @click="undo()">Undo table change</button>
          <button class="ghost" :disabled="!future.length" @click="undo(true)">Redo table change</button>
          <button class="ghost" @click="clear">Clear selected cells</button>
          <button class="ghost" @click="copyMarkdown">Copy table as Markdown</button>
        </template>
        <template v-if="menu === 'row'">
          <strong>Row {{ active.row === 0 ? 'header' : active.row }}</strong>
          <button class="ghost" @click="change(t => insertRow(t, active.row))">Insert above</button>
          <button class="ghost" @click="change(t => insertRow(t, active.row + 1))">Insert below</button>
          <button class="ghost" @click="change(t => insertRow(t, active.row + 1, active.row))">Duplicate row</button>
          <button class="ghost" :disabled="active.row <= 1" @click="change(t => { moveRow(t, active.row, -1); active.row--; anchor = { ...active }; })">Move row up</button>
          <button class="ghost" :disabled="active.row === 0 || active.row === draft.cells.length - 1" @click="change(t => { moveRow(t, active.row, 1); active.row++; anchor = { ...active }; })">Move row down</button>
          <button class="ghost table-danger" :disabled="bounds.bottom === 0" @click="change(t => deleteRows(t, bounds.top, bounds.bottom))">Delete {{ selectionKind === 'rows' ? 'selected rows' : 'row' }}</button>
        </template>
        <template v-if="menu === 'column'">
          <strong>Column {{ columnLabel(active.col) }}</strong>
          <button class="ghost" @click="change(t => insertColumn(t, active.col))">Insert left</button>
          <button class="ghost" @click="change(t => insertColumn(t, active.col + 1))">Insert right</button>
          <button class="ghost" @click="change(t => insertColumn(t, active.col + 1, active.col))">Duplicate column</button>
          <button class="ghost" :disabled="active.col === 0" @click="change(t => { moveColumn(t, active.col, -1); active.col--; anchor = { ...active }; })">Move column left</button>
          <button class="ghost" :disabled="active.col === draft.align.length - 1" @click="change(t => { moveColumn(t, active.col, 1); active.col++; anchor = { ...active }; })">Move column right</button>
          <button class="ghost table-danger" :disabled="allColumns" @click="change(t => deleteColumns(t, bounds.left, bounds.right))">Delete {{ selectionKind === 'columns' ? 'selected columns' : 'column' }}</button>
        </template>
        <template v-if="menu === 'align'">
          <strong>Column alignment</strong>
          <button v-for="alignment in (['default', 'left', 'center', 'right'] as const)" :key="alignment" class="ghost" :aria-pressed="draft.align[active.col] === alignment" @click="change(t => { for (let c = bounds.left; c <= bounds.right; c++) t.align[c] = alignment; })">{{ alignment[0].toUpperCase() + alignment.slice(1) }}</button>
        </template>
        <template v-if="menu === 'sort'">
          <strong>Sort body rows</strong>
          <label>Sort by<select v-model="sortColumn" aria-label="Sort by"><option v-for="(_, c) in draft.align" :key="c" :value="c">{{ columnLabel(c) }} · {{ draft.cells[0][c] || 'Untitled' }}</option></select></label>
          <label>Treat as<select v-model="sortMode" aria-label="Treat as"><option value="auto">Auto</option><option value="text">Text</option><option value="number">Number</option></select></label>
          <label>Order<select v-model="sortDirection" aria-label="Order"><option value="asc">Ascending</option><option value="desc">Descending</option></select></label>
          <small>Header stays fixed. Empty cells stay last.</small>
          <button @click="change(t => sortRows(t, sortColumn, sortDirection, sortMode))">Sort rows</button>
        </template>
        <template v-if="menu === 'more'">
          <button class="ghost" @click="clear">Clear selected cells</button>
          <button class="ghost" @click="copyMarkdown">Copy table as Markdown</button>
          <small>Arrows move · Enter edits<br>Tab advances · Shift+arrows selects<br>⌘/Ctrl+Enter applies<br>Escape cancels a cell edit, then the table</small>
        </template>
        <button class="linkish" @click="menu = null; focusCell()">Close menu</button>
      </div>
    </div>
    <div v-if="conflict || disabled" class="table-editor-notice" role="alert">
      {{ disabled ? 'This note is no longer editable.' : conflictMessage || 'This table changed in the note. Your draft is still here.' }}
      <button class="ghost" @click="copyMarkdown">Copy draft</button>
      <button v-if="!disabled" class="ghost" @click="emit('reload')">Reload table</button>
    </div>
    <div class="table-grid-scroll" @copy="copy" @paste="paste">
      <table class="table-grid" role="grid" aria-label="Editable Markdown table" :aria-rowcount="draft.cells.length + 1" :aria-colcount="draft.align.length + 1">
        <thead>
          <tr class="table-column-labels" aria-rowindex="1"><th class="table-gutter" /><th v-for="(_, c) in draft.align" :key="c"><button type="button" class="linkish" :aria-label="`Select column ${columnLabel(c)}`" @click="selectColumn(c, $event.shiftKey)">{{ columnLabel(c) }} <span>▾</span></button></th></tr>
        </thead>
        <tbody>
          <tr v-for="(row, r) in draft.cells" :key="r" :class="{ 'table-header-row': r === 0 }" :aria-rowindex="r + 2">
            <th class="table-gutter"><button type="button" class="linkish" :aria-label="r === 0 ? 'Select header row' : `Select row ${r}`" @click="selectRow(r, $event.shiftKey)">{{ r === 0 ? 'H' : r }}</button></th>
            <td v-for="(value, c) in row" :key="c" :data-cell="`${r}:${c}`" role="gridcell" :aria-label="`${columnLabel(c)}${r === 0 ? ' header' : `${r} · ${draft.cells[0][c] || 'Untitled'}`}: ${value || 'Empty'}`" :aria-colindex="c + 2" :aria-selected="selected(r, c)" :tabindex="active.row === r && active.col === c ? 0 : -1" :class="{ 'is-selected': selected(r, c), 'is-active': active.row === r && active.col === c }" :style="{ textAlign: draft.align[c] === 'default' ? 'left' : draft.align[c] }" @click.prevent="select(r, c, $event.shiftKey)" @dblclick.prevent="begin()">
              <textarea v-if="editing && !mobile && active.row === r && active.col === c" v-model="editValue" data-cell-input :aria-label="`Edit ${address}`" rows="2" spellcheck="false" @click.stop @dblclick.stop />
              <div v-else class="table-cell-content" inert v-html="value ? renderTableCell(value) : '&nbsp;'" />
            </td>
          </tr>
        </tbody>
      </table>
      <button type="button" class="linkish table-add-row" @click="change(t => insertRow(t, t.cells.length))">+ Add row</button>
    </div>
    <footer class="table-editor-footer" @paste="paste">
      <div class="table-cell-status"><span>{{ address }}<template v-if="active.row > 0"> · {{ draft.cells[0][active.col] || 'Untitled' }}</template></span><span v-if="mobile"><button class="ghost" aria-label="Previous cell" @click="travel(-1)">‹</button> <button class="ghost" aria-label="Next cell" @click="travel(1)">›</button></span><small v-else>Tab: next cell · Enter: edit · Shift+Enter: line break</small></div>
      <textarea v-if="mobile && editing" v-model="editValue" data-cell-input :aria-label="`Edit ${address}`" rows="2" />
      <small>{{ editing ? 'Inline Markdown supported. Line breaks are saved as <br>.' : 'Changes stay in this draft until you apply.' }}</small>
      <span class="table-announcement" role="status">{{ message }}</span>
    </footer>
  </dialog>
</template>
