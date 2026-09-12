import { type EditorState } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import {
  type TableBlock,
  separatorPipes,
  tableOverlapsDelim,
  tableParser,
} from "./tables";

type TableOverlay = {
  mat: HTMLElement;
  chrome: HTMLElement;
  hscroll: HTMLElement;
  spacer: HTMLElement;
  fromLine: number;
  toLine: number;
  scrollLeft: number;
};

function parseFromState(state: EditorState): TableBlock[] {
  return tableParser.parse(state.doc.lines, (number) => state.doc.line(number).text);
}

export function updateNeedsTableParse(update: ViewUpdate, tables: TableBlock[]): boolean {
  let needed = false;
  update.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    if (needed) return;
    const startLine = update.startState.doc.lineAt(fromA).number;
    const endPos = toA > fromA ? toA - 1 : fromA;
    const endLine = update.startState.doc.lineAt(endPos).number;
    needed = tableParser.scanNeeded({
      deleted: update.startState.doc.sliceString(fromA, toA),
      inserted: inserted.toString(),
      overlapsDelim: tableOverlapsDelim(tables, startLine, endLine),
    });
  });
  return needed;
}

function tableDecorations(state: EditorState, tables: TableBlock[]): DecorationSet {
  const decos = [];
  for (const table of tables) {
    for (let number = table.fromLine; number <= table.toLine; number += 1) {
      const line = state.doc.line(number);
      const classes = ["cm-table"];
      if (number === table.fromLine) classes.push("cm-table-first", "cm-table-header");
      if (number === table.toLine) classes.push("cm-table-last");
      if (number === table.delimLine) classes.push("cm-table-delim");
      decos.push(Decoration.line({ class: classes.join(" ") }).range(line.from));
      for (const pipe of separatorPipes(line.text)) {
        const from = line.from + pipe;
        decos.push(Decoration.mark({ class: "cm-md-marker cm-table-pipe" }).range(from, from + 1));
      }
    }
  }
  return Decoration.set(decos, true);
}

function lineElement(view: EditorView, pos: number): HTMLElement | null {
  try {
    const { node } = view.domAtPos(pos);
    const el = node instanceof HTMLElement ? node : node.parentElement;
    return el?.closest(".cm-line") ?? null;
  } catch {
    return null;
  }
}

function sameTables(left: TableBlock[], right: TableBlock[]): boolean {
  return (
    left.length === right.length &&
    left.every(
      (table, i) =>
        table.fromLine === right[i]?.fromLine &&
        table.toLine === right[i]?.toLine &&
        table.delimLine === right[i]?.delimLine,
    )
  );
}

function mapLine(update: ViewUpdate, line: number): number {
  if (line < 1 || line > update.startState.doc.lines) return line;
  const pos = update.startState.doc.line(line).from;
  return update.state.doc.lineAt(update.changes.mapPos(pos, 1)).number;
}

function createOverlay(back: HTMLElement, front: HTMLElement): TableOverlay {
  const mat = document.createElement("div");
  mat.className = "cm-table-mat";
  mat.setAttribute("data-testid", "table-mat");
  back.append(mat);
  const chrome = document.createElement("div");
  chrome.className = "cm-table-chrome";
  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "cm-table-edit";
  edit.setAttribute("data-testid", "table-edit");
  edit.setAttribute("aria-label", "Edit table");
  edit.textContent = "Edit table";
  edit.addEventListener("mousedown", (event) => event.preventDefault());
  const hscroll = document.createElement("div");
  hscroll.className = "cm-table-hscroll";
  const spacer = document.createElement("div");
  spacer.className = "cm-table-hscroll-inner";
  hscroll.append(spacer);
  chrome.append(edit, hscroll);
  front.append(chrome);
  const overlay: TableOverlay = {
    mat,
    chrome,
    hscroll,
    spacer,
    fromLine: 0,
    toLine: 0,
    scrollLeft: 0,
  };
  hscroll.addEventListener("scroll", () => {
    overlay.scrollLeft = hscroll.scrollLeft;
    syncLineScroll(overlay, front);
  });
  return overlay;
}

function syncLineScroll(overlay: TableOverlay, front: HTMLElement) {
  const editor = front.parentElement;
  if (!editor) return;
  editor.querySelectorAll(".cm-line.cm-table").forEach((line) => {
    const number = Number((line as HTMLElement).dataset.tableLine ?? 0);
    if (number >= overlay.fromLine && number <= overlay.toLine) {
      (line as HTMLElement).scrollLeft = overlay.scrollLeft;
    }
  });
}

function layoutOverlay(view: EditorView, overlay: TableOverlay, table: TableBlock) {
  overlay.fromLine = table.fromLine;
  overlay.toLine = table.toLine;
  overlay.mat.dataset.fromLine = String(table.fromLine);
  overlay.mat.dataset.toLine = String(table.toLine);
  overlay.mat.dataset.lines = String(table.toLine - table.fromLine + 1);
  let maxScroll = 0;
  for (let number = table.fromLine; number <= table.toLine; number += 1) {
    const line = view.state.doc.line(number);
    const el = lineElement(view, line.from);
    if (!el) continue;
    el.dataset.tableLine = String(number);
    if (el.scrollLeft !== overlay.scrollLeft) el.scrollLeft = overlay.scrollLeft;
    maxScroll = Math.max(maxScroll, el.scrollWidth);
    el.onscroll = () => {
      if (el.scrollLeft === overlay.scrollLeft) return;
      overlay.scrollLeft = el.scrollLeft;
      syncLineScroll(overlay, overlay.chrome);
      if (overlay.hscroll.scrollLeft !== overlay.scrollLeft) overlay.hscroll.scrollLeft = overlay.scrollLeft;
    };
  }
  overlay.spacer.style.width = `${maxScroll}px`;
  if (overlay.hscroll.scrollLeft !== overlay.scrollLeft) overlay.hscroll.scrollLeft = overlay.scrollLeft;
  const first = view.state.doc.line(table.fromLine);
  const last = view.state.doc.line(table.toLine);
  let start: { top: number; bottom: number } | null = null;
  let end: { top: number; bottom: number } | null = null;
  try {
    start = view.lineBlockAt(first.from);
    end = view.lineBlockAt(last.from);
  } catch {
    return;
  }
  const editor = view.dom.getBoundingClientRect();
  const content = view.contentDOM.getBoundingClientRect();
  const widthPx = view.scrollDOM.clientWidth || content.width;
  overlay.hscroll.style.display = maxScroll > widthPx + 1 ? "" : "none";
  const top = `${start.top + view.documentTop - editor.top}px`;
  const left = `${content.left - editor.left}px`;
  const width = `${Math.max(0, widthPx)}px`;
  const height = `${Math.max(0, end.bottom - start.top)}px`;
  for (const el of [overlay.mat, overlay.chrome]) {
    el.style.top = top;
    el.style.left = left;
    el.style.width = width;
    el.style.height = height;
  }
}

export class TableView {
  decorations: DecorationSet;
  tables: TableBlock[];
  overlays: TableOverlay[] = [];
  back: HTMLElement;
  front: HTMLElement;
  parseCount = 0;

  constructor(view: EditorView) {
    this.back = document.createElement("div");
    this.back.className = "cm-table-back";
    this.front = document.createElement("div");
    this.front.className = "cm-table-front";
    view.dom.insertBefore(this.back, view.dom.firstChild);
    view.dom.append(this.front);
    this.tables = parseFromState(view.state);
    this.parseCount += 1;
    this.decorations = tableDecorations(view.state, this.tables);
    this.syncOverlays(view);
    this.measure(view);
  }

  update(update: ViewUpdate) {
    let relayout = false;
    if (update.docChanged) {
      if (updateNeedsTableParse(update, this.tables)) {
        const next = parseFromState(update.state);
        this.parseCount += 1;
        const shapeChanged = !sameTables(this.tables, next);
        this.tables = next;
        this.decorations = tableDecorations(update.state, this.tables);
        if (shapeChanged) this.syncOverlays(update.view, update);
        relayout = true;
      } else {
        this.decorations = this.decorations.map(update.changes);
      }
    }
    if (relayout || update.geometryChanged || update.viewportChanged) {
      this.measure(update.view);
    }
  }

  syncOverlays(_view: EditorView, update?: ViewUpdate) {
    const next: TableOverlay[] = [];
    const used = new Set<TableOverlay>();
    for (const table of this.tables) {
      let overlay = this.overlays.find((entry) => !used.has(entry) && entry.fromLine === table.fromLine);
      if (!overlay && update) {
        overlay = this.overlays.find(
          (entry) => !used.has(entry) && mapLine(update, entry.fromLine) === table.fromLine,
        );
      }
      if (!overlay) overlay = createOverlay(this.back, this.front);
      used.add(overlay);
      overlay.fromLine = table.fromLine;
      overlay.toLine = table.toLine;
      overlay.mat.dataset.fromLine = String(table.fromLine);
      overlay.mat.dataset.toLine = String(table.toLine);
      overlay.mat.dataset.lines = String(table.toLine - table.fromLine + 1);
      next.push(overlay);
    }
    for (const overlay of this.overlays) {
      if (!used.has(overlay)) {
        overlay.mat.remove();
        overlay.chrome.remove();
      }
    }
    this.overlays = next;
  }

  layoutAll(view: EditorView) {
    for (const overlay of this.overlays) {
      const table = this.tables.find((entry) => entry.fromLine === overlay.fromLine);
      if (table) layoutOverlay(view, overlay, table);
    }
  }

  measure(view: EditorView) {
    view.requestMeasure({
      key: this,
      read: (vw) => {
        this.layoutAll(vw);
        return null;
      },
      write() {},
    });
  }

  destroy() {
    this.back.remove();
    this.front.remove();
    this.overlays = [];
  }
}

export const tablePlugin = ViewPlugin.fromClass(TableView, {
  decorations: (value) => value.decorations,
  eventHandlers: {
    wheel(event, view) {
      const self = view.plugin(tablePlugin);
      if (!self) return false;
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos == null) return false;
      const line = view.state.doc.lineAt(pos).number;
      const overlay = self.overlays.find((entry) => line >= entry.fromLine && line <= entry.toLine);
      if (!overlay) return false;
      const dx = event.deltaX || (event.shiftKey ? event.deltaY : 0);
      if (!dx) return false;
      event.preventDefault();
      overlay.scrollLeft = Math.max(0, overlay.scrollLeft + dx);
      self.layoutAll(view);
      return true;
    },
  },
});

export function tableExtension() {
  return tablePlugin;
}

export function tablePluginState(view: EditorView): TableView | null {
  return view.plugin(tablePlugin);
}
