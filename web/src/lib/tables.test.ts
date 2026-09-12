import { describe, expect, it, vi } from "vitest";
import {
  isDelimiterLine,
  parseTablesFromSource,
  rowCells,
  separatorPipes,
  tableOverlapsChange,
  tableOverlapsDelim,
  tableParser,
  tableScanNeeded,
} from "./tables";

const SAMPLE = `| Name | Qty | Notes |
| --- | ---: | --- |
| Apples | 12 | keep cold |
| Bread | 2 | |`;

describe("tableScanNeeded", () => {
  it("skips prose that cannot affect tables", () => {
    expect(tableScanNeeded({ deleted: "", inserted: "x", overlapsDelim: false })).toBe(false);
    expect(tableScanNeeded({ deleted: "a", inserted: "b", overlapsDelim: false })).toBe(false);
  });

  it("rescans when a pipe or newline is inserted or deleted", () => {
    expect(tableScanNeeded({ deleted: "", inserted: "|", overlapsDelim: false })).toBe(true);
    expect(tableScanNeeded({ deleted: "|", inserted: "", overlapsDelim: false })).toBe(true);
    expect(tableScanNeeded({ deleted: "", inserted: "\n", overlapsDelim: false })).toBe(true);
    expect(tableScanNeeded({ deleted: "\n", inserted: "", overlapsDelim: false })).toBe(true);
  });

  it("skips cell edits and only rescans delimiter-line edits without a pipe", () => {
    expect(tableScanNeeded({ deleted: "s", inserted: "", overlapsDelim: false })).toBe(false);
    expect(tableScanNeeded({ deleted: "", inserted: "x", overlapsDelim: true })).toBe(true);
  });
});

describe("parseTablesFromSource", () => {
  it("finds a header, delimiter, and body", () => {
    expect(parseTablesFromSource(SAMPLE)).toEqual([
      { fromLine: 1, toLine: 4, headerLine: 1, delimLine: 2 },
    ]);
  });

  it("does not shade pipes without a delimiter", () => {
    expect(parseTablesFromSource("| a | b |\n| c | d |")).toEqual([]);
  });

  it("shades header plus delimiter with no body", () => {
    expect(parseTablesFromSource("| a | b |\n| --- | --- |")).toEqual([
      { fromLine: 1, toLine: 2, headerLine: 1, delimLine: 2 },
    ]);
  });

  it("allows a wiki pipe inside a cell", () => {
    const source = "| [[page|label]] | x |\n| --- | --- |\n| a | b |";
    expect(parseTablesFromSource(source)).toHaveLength(1);
    expect(rowCells("| [[page|label]] | x |")).toEqual([" [[page|label]] ", " x "]);
    expect(separatorPipes("| [[page|label]] | x |")).toEqual([0, 17, 21]);
  });

  it("does not treat an escaped pipe as a cell break", () => {
    expect(rowCells("| a \\| b | c |")).toEqual([" a \\| b ", " c "]);
    expect(parseTablesFromSource("| a \\| b | c |\n| --- | --- |")).toHaveLength(1);
  });

  it("ignores fenced pipes", () => {
    const source = "```\n| a | b |\n| --- | --- |\n```\n\n| a | b |\n| --- | --- |";
    expect(parseTablesFromSource(source)).toEqual([
      { fromLine: 6, toLine: 7, headerLine: 6, delimLine: 7 },
    ]);
  });

  it("ignores 4-space indented pipes", () => {
    expect(parseTablesFromSource("    | a | b |\n    | --- | --- |")).toEqual([]);
  });

  it("splits on a blank line and grows when the blank is removed", () => {
    const split = `| a | b |\n| --- | --- |\n| c | d |\n\n| e | f |`;
    expect(parseTablesFromSource(split)).toEqual([
      { fromLine: 1, toLine: 3, headerLine: 1, delimLine: 2 },
    ]);
    const joined = `| a | b |\n| --- | --- |\n| c | d |\n| e | f |`;
    expect(parseTablesFromSource(joined)).toEqual([
      { fromLine: 1, toLine: 4, headerLine: 1, delimLine: 2 },
    ]);
  });

  it("shrinks when a body line is deleted", () => {
    const full = `| a | b |\n| --- | --- |\n| c | d |\n| e | f |`;
    const trimmed = `| a | b |\n| --- | --- |\n| c | d |`;
    expect(parseTablesFromSource(full)[0]?.toLine).toBe(4);
    expect(parseTablesFromSource(trimmed)[0]?.toLine).toBe(3);
  });

  it("disappears when the delimiter is broken", () => {
    expect(parseTablesFromSource("| a | b |\n| -x- | --- |")).toEqual([]);
    expect(isDelimiterLine("| --- | ---: | :--- |")).toBe(true);
    expect(isDelimiterLine("| -x- | --- |")).toBe(false);
  });

  it("finds more than one table", () => {
    const source = `| a | b |\n| --- | --- |\n\ntext\n\n| c | d |\n| --- | --- |\n| e | f |`;
    expect(parseTablesFromSource(source)).toEqual([
      { fromLine: 1, toLine: 2, headerLine: 1, delimLine: 2 },
      { fromLine: 6, toLine: 8, headerLine: 6, delimLine: 7 },
    ]);
  });
});

describe("tableOverlapsChange", () => {
  it("detects line ranges that sit inside a table", () => {
    const tables = parseTablesFromSource(SAMPLE);
    expect(tableOverlapsChange(tables, 3, 3)).toBe(true);
    expect(tableOverlapsChange(tables, 5, 5)).toBe(false);
    expect(tableOverlapsDelim(tables, 2, 2)).toBe(true);
    expect(tableOverlapsDelim(tables, 3, 3)).toBe(false);
  });
});

describe("tableParser", () => {
  it("is the hook tests spy for parse timing", () => {
    const parse = vi.spyOn(tableParser, "parseFromSource");
    tableParser.parseFromSource("| a | b |\n| --- | --- |");
    expect(parse).toHaveBeenCalledTimes(1);
    parse.mockRestore();
  });
});
