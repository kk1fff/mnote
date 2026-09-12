import { describe, expect, it } from "vitest";
import { cloneTable, columnLabel, deleteColumns, deleteRows, insertColumn, insertRow, mapTableRange, moveColumn, moveRow, pasteCells, readTable, safeCell, sortRows, writeTable } from "./table-editor";
import { renderMarkdown, renderTableCell } from "./markdown";

describe("table draft", () => {
  it("round trips Markdown, empty cells, aliases, alignment and uneven rows without losing data", () => {
    const source = "| Name | Count | Notes | Empty |\n| :--- | ---: | :---: | --- |\n| **猫** | 12 | [[Page|alias]] and a\\|b | |\n| `code` |\n| [link](https://example.com) | 2 | first<br>second | | extra |";
    const draft = readTable(source);
    expect(draft.align).toEqual(["left", "right", "center", "default", "default"]);
    expect(draft.cells[1][2]).toBe("[[Page|alias]] and a\\|b");
    expect(draft.cells[2]).toEqual(["`code`", "", "", "", ""]);
    expect(readTable(writeTable(draft))).toEqual(draft);
    const html = renderMarkdown(writeTable(draft));
    expect(html).toContain('data-wiki="Page"');
    expect(html).toContain("alias</a> and a|b");
    expect(html).toContain("first<br>");
    expect(html).toContain("extra</td>");
  });

  it("escapes new structural pipes and converts line breaks without enabling HTML", () => {
    expect(safeCell("a|b\n[[Page|alias]]\\|c")).toBe("a\\|b<br>[[Page|alias]]\\|c");
    expect(renderTableCell("**bold**<br><script>alert(1)</script>")).toContain("<strong>bold</strong><br>");
    expect(renderTableCell("<script>alert(1)</script>")).not.toContain("<script>");
  });

  it("keeps headers and alignment attached when duplicating, moving and deleting columns", () => {
    const draft = readTable("| A | B |\n| --- | ---: |\n| x | 2 |");
    insertColumn(draft, 1, 1);
    moveColumn(draft, 0, 1);
    expect(draft.cells).toEqual([["B", "A", "B"], ["2", "x", "2"]]);
    expect(draft.align).toEqual(["right", "default", "right"]);
    deleteColumns(draft, 0, 1);
    expect(draft.cells).toEqual([["B"], ["2"]]);
    deleteColumns(draft, 0, 0);
    expect(draft.align).toEqual(["right"]);
  });

  it("protects the header while allowing an empty body, insertion and row movement", () => {
    const draft = readTable("| A |\n| --- |\n| one |\n| two |");
    insertRow(draft, 2, 1);
    moveRow(draft, 3, -1);
    expect(draft.cells.flat()).toEqual(["A", "one", "two", "one"]);
    moveRow(draft, 1, -1);
    deleteRows(draft, 0, 3);
    expect(draft.cells).toEqual([["A"]]);
    insertRow(draft, 0);
    expect(draft.cells).toEqual([["A"], [""]]);
    expect(readTable(writeTable(draft))).toEqual(draft);
  });

  it("sorts complete rows numerically, stably, with blanks last in either direction", () => {
    const draft = readTable("| Name | Qty |\n| --- | --- |\n| first | 12 |\n| blank | |\n| second | 2 |\n| tied | 2 |");
    sortRows(draft, 1, "asc", "auto");
    expect(draft.cells.map(r => r[0])).toEqual(["Name", "second", "tied", "first", "blank"]);
    sortRows(draft, 1, "desc", "number");
    expect(draft.cells.map(r => r[0])).toEqual(["Name", "first", "second", "tied", "blank"]);
    sortRows(draft, 0, "asc", "text");
    expect(draft.cells.map(r => r[0])).toEqual(["Name", "blank", "first", "second", "tied"]);
  });

  it("pastes rectangles, preserving blank cells and growing both dimensions", () => {
    const draft = readTable("| A |\n| --- |");
    const original = cloneTable(draft);
    expect(pasteCells(draft, { row: 1, col: 0 }, "x\t\r\ny\tz\r\n")).toEqual({ row: 2, col: 1 });
    expect(draft.cells).toEqual([["A", ""], ["x", ""], ["y", "z"]]);
    expect(original.cells).toEqual([["A"]]);
  });

  it("maps unrelated document changes but rejects edits inside the draft range", () => {
    const before = "before\nTABLE\nafter";
    expect(mapTableRange(before, "longer before\nTABLE\nafter", 7, 12)).toEqual({ from: 14, to: 19 });
    expect(mapTableRange(before, "before\nTABLE\nafter changed", 7, 12)).toEqual({ from: 7, to: 12 });
    expect(mapTableRange(before, "before\nCHANGED\nafter", 7, 12)).toBeNull();
    expect(mapTableRange(before, "before\n\nafter", 7, 12)).toBeNull();
    expect(columnLabel(0)).toBe("A");
    expect(columnLabel(26)).toBe("AA");
  });
});
