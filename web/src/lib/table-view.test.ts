import { EditorState, EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it, vi } from "vitest";
import { tableExtension, tablePluginState } from "./table-view";
import { tableParser } from "./tables";

const TABLE = `| Name | Qty | Notes |
| --- | ---: | --- |
| Apples | 12 | keep cold |
| Bread | 2 | |`;

function makeView(doc: string) {
  const parent = document.createElement("div");
  document.body.append(parent);
  return new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [EditorView.lineWrapping, tableExtension()],
    }),
  });
}

function insert(view: EditorView, from: number, to: number, text: string) {
  view.dispatch({ changes: { from, to, insert: text }, selection: EditorSelection.cursor(from + text.length) });
}

describe("table view", () => {
  it("does not shade pipes without a delimiter", () => {
    const view = makeView("| a | b |\n| c | d |");
    expect(view.dom.querySelector(".cm-table")).toBeNull();
    expect(view.dom.querySelector("[data-testid='table-mat']")).toBeNull();
    view.destroy();
  });

  it("shades a valid table on first paint", () => {
    const view = makeView(TABLE);
    expect(view.dom.querySelectorAll(".cm-table")).toHaveLength(4);
    expect(view.dom.querySelector("[data-testid='table-mat']")).toBeTruthy();
    expect(view.dom.querySelector("[data-testid='table-edit']")?.textContent).toBe("Edit table");
    expect(view.dom.querySelectorAll(".cm-table-pipe").length).toBeGreaterThan(3);
    view.destroy();
  });

  it("parses on first paint, not on prose or cell repeats, and again when a pipe or newline can change tables", () => {
    const parse = vi.spyOn(tableParser, "parse");
    const view = makeView(`hello\n\n${TABLE}`);
    const plugin = tablePluginState(view);
    expect(plugin?.parseCount).toBe(1);
    expect(parse).toHaveBeenCalledTimes(1);

    insert(view, 0, 0, "x");
    expect(plugin?.parseCount).toBe(1);

    const apples = view.state.doc.toString().indexOf("Apples") + 6;
    for (let i = 0; i < 12; i += 1) insert(view, apples + i, apples + i, "a");
    expect(plugin?.parseCount).toBe(1);
    expect(parse).toHaveBeenCalledTimes(1);

    const after = view.state.doc.toString().indexOf("| Bread");
    const lineEnd = view.state.doc.lineAt(after).to;
    insert(view, lineEnd, lineEnd, "\n| Pears | 1 | ");
    expect(plugin?.parseCount).toBe(2);
    parse.mockRestore();
    view.destroy();
  });

  it("shows the shade when the delimiter becomes valid and hides it when it breaks", () => {
    const view = makeView("| a | b |");
    expect(view.dom.querySelector(".cm-table")).toBeNull();
    insert(view, view.state.doc.length, view.state.doc.length, "\n| --- | --- |");
    expect(view.dom.querySelectorAll(".cm-table").length).toBe(2);
    expect(view.dom.querySelector("[data-testid='table-mat']")).toBeTruthy();

    const delim = view.state.doc.toString().indexOf("---");
    insert(view, delim + 1, delim + 1, "x");
    expect(view.dom.querySelector(".cm-table")).toBeNull();
    expect(view.dom.querySelector("[data-testid='table-mat']")).toBeNull();
    view.destroy();
  });

  it("does not recreate the mat when editing an existing table cell", () => {
    const view = makeView(TABLE);
    const mat = view.dom.querySelector("[data-testid='table-mat']");
    expect(mat).toBeTruthy();
    const apples = view.state.doc.toString().indexOf("Apples");
    insert(view, apples + 6, apples + 6, "!");
    expect(view.dom.querySelector("[data-testid='table-mat']")).toBe(mat);
    expect(mat?.isConnected).toBe(true);
    expect(view.dom.querySelectorAll(".cm-table")).toHaveLength(4);
    view.destroy();
  });

  it("grows the shade when a body row is added and shrinks when one is deleted", () => {
    const view = makeView(TABLE);
    const mat = view.dom.querySelector("[data-testid='table-mat']") as HTMLElement;
    expect(mat.dataset.lines).toBe("4");
    const end = view.state.doc.length;
    insert(view, end, end, "\n| Pears | 1 | ");
    expect(mat.isConnected).toBe(true);
    expect(view.dom.querySelectorAll(".cm-table")).toHaveLength(5);
    expect(mat.dataset.lines).toBe("5");

    const pears = view.state.doc.toString().indexOf("| Pears");
    const pearsLine = view.state.doc.lineAt(pears);
    insert(view, pearsLine.from - 1, pearsLine.to, "");
    expect(view.dom.querySelectorAll(".cm-table")).toHaveLength(4);
    expect(mat.dataset.lines).toBe("4");
    view.destroy();
  });

  it("splits the shade when a blank line is inserted in the body", () => {
    const view = makeView(TABLE);
    const bread = view.state.doc.toString().indexOf("| Bread");
    insert(view, bread, bread, "\n");
    expect(view.dom.querySelectorAll(".cm-table")).toHaveLength(3);
    expect(view.dom.querySelector("[data-testid='table-mat']")).toBeTruthy();
    expect(view.state.doc.toString()).toContain("| Bread");
    expect(view.dom.querySelectorAll(".cm-table")).toHaveLength(3);
    view.destroy();
  });
});
