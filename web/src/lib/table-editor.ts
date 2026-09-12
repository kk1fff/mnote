import { rowCells, separatorPipes } from "./tables";

export type Alignment = "default" | "left" | "center" | "right";
export type TableDraft = { cells: string[][]; align: Alignment[] };
export type Cell = { row: number; col: number };

export function readTable(source: string): TableDraft {
  const lines = source.split("\n");
  const cells = lines.filter((_, i) => i !== 1).map((line) => rowCells(line).map((s) => s.trim()));
  const separators = rowCells(lines[1] ?? "");
  const width = Math.max(1, separators.length, ...cells.map((row) => row.length));
  for (const row of cells) while (row.length < width) row.push("");
  return {
    cells,
    align: Array.from({ length: width }, (_, i) => {
      const value = separators[i]?.trim() ?? "";
      return value.startsWith(":") ? (value.endsWith(":") ? "center" : "left") : value.endsWith(":") ? "right" : "default";
    }),
  };
}

export function cloneTable(table: TableDraft): TableDraft {
  return { cells: table.cells.map((row) => [...row]), align: [...table.align] };
}

// Only structural pipes need escaping; wiki-link aliases and escaped pipes stay intact.
export function safeCell(value: string): string {
  const pipes = new Set(separatorPipes(value));
  return value.split("").map((ch, i) => pipes.has(i) ? "\\|" : ch).join("").replace(/\r\n?|\n/g, "<br>");
}

export function writeTable(table: TableDraft): string {
  const row = (values: string[]) => `| ${values.map(safeCell).join(" | ")} |`;
  const markers = { default: "---", left: ":---", center: ":---:", right: "---:" };
  return [row(table.cells[0]), row(table.align.map((a) => markers[a])), ...table.cells.slice(1).map(row)].join("\n");
}

export function insertRow(table: TableDraft, at: number, duplicate?: number) {
  table.cells.splice(Math.max(1, at), 0, duplicate === undefined ? table.align.map(() => "") : [...table.cells[duplicate]]);
}

export function insertColumn(table: TableDraft, at: number, duplicate?: number) {
  table.align.splice(at, 0, duplicate === undefined ? "default" : table.align[duplicate]);
  for (const row of table.cells) row.splice(at, 0, duplicate === undefined ? "" : row[duplicate]);
}

export function deleteRows(table: TableDraft, from: number, to: number) {
  const start = Math.max(1, from);
  if (to >= start) table.cells.splice(start, to - start + 1);
}

export function deleteColumns(table: TableDraft, from: number, to: number) {
  if (to - from + 1 >= table.align.length) return;
  table.align.splice(from, to - from + 1);
  for (const row of table.cells) row.splice(from, to - from + 1);
}

export function moveRow(table: TableDraft, at: number, delta: number) {
  const target = at + delta;
  if (at < 1 || target < 1 || target >= table.cells.length) return;
  [table.cells[at], table.cells[target]] = [table.cells[target], table.cells[at]];
}

export function moveColumn(table: TableDraft, at: number, delta: number) {
  const target = at + delta;
  if (target < 0 || target >= table.align.length) return;
  [table.align[at], table.align[target]] = [table.align[target], table.align[at]];
  for (const row of table.cells) [row[at], row[target]] = [row[target], row[at]];
}

export function sortRows(table: TableDraft, col: number, direction: "asc" | "desc", mode: "auto" | "text" | "number") {
  const number = (value: string) => /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()) ? Number(value) : NaN;
  const numeric = mode === "number" || (mode === "auto" && table.cells.slice(1).every((row) => !row[col].trim() || Number.isFinite(number(row[col]))));
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  const rows = table.cells.slice(1).map((row, i) => ({ row, i }));
  rows.sort((a, b) => {
    const left = a.row[col].trim(), right = b.row[col].trim();
    if (!left || !right) return left ? -1 : right ? 1 : a.i - b.i;
    const ln = number(left), rn = number(right);
    const cmp = numeric && Number.isFinite(ln) && Number.isFinite(rn) ? ln - rn : collator.compare(left, right);
    return (direction === "asc" ? cmp : -cmp) || a.i - b.i;
  });
  table.cells = [table.cells[0], ...rows.map(({ row }) => row)];
}

export function pasteCells(table: TableDraft, start: Cell, text: string): Cell {
  const rows = text.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n").map((row) => row.split("\t"));
  const width = Math.max(...rows.map((row) => row.length));
  while (table.align.length < start.col + width) insertColumn(table, table.align.length);
  while (table.cells.length < start.row + rows.length) insertRow(table, table.cells.length);
  rows.forEach((row, r) => row.forEach((value, c) => { table.cells[start.row + r][start.col + c] = value; }));
  return { row: start.row + rows.length - 1, col: start.col + width - 1 };
}

export function columnLabel(index: number): string {
  let label = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) label = String.fromCharCode(65 + (n - 1) % 26) + label;
  return label;
}

// Parent updates can replace the whole document. Reduce them to their changed range
// so unrelated edits can safely move an open table's anchor.
export function mapTableRange(before: string, after: string, from: number, to: number): { from: number; to: number } | null {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let end = before.length, nextEnd = after.length;
  while (end > start && nextEnd > start && before[end - 1] === after[nextEnd - 1]) { end--; nextEnd--; }
  if (end <= from) {
    const delta = nextEnd - end;
    return { from: from + delta, to: to + delta };
  }
  if (start >= to) return { from, to };
  return null;
}
