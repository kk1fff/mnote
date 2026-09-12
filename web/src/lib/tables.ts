export type TableBlock = {
  fromLine: number;
  toLine: number;
  headerLine: number;
  delimLine: number;
};

const FENCE_RE = /^( {0,3})(```+|~~~+)/;
const DELIM_CELL_RE = /^\s*:?-+:?\s*$/;

export function tableScanNeeded(input: {
  deleted: string;
  inserted: string;
  overlapsTable: boolean;
}): boolean {
  if (input.overlapsTable) return true;
  return /[|\n\r]/.test(input.deleted) || /[|\n\r]/.test(input.inserted);
}

export function tableOverlapsChange(
  tables: TableBlock[],
  startLine: number,
  endLine: number,
): boolean {
  return tables.some((table) => !(endLine < table.fromLine || startLine > table.toLine));
}

export function separatorPipes(text: string): number[] {
  const out: number[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "[" && text[i + 1] === "[") {
      const close = text.indexOf("]]", i + 2);
      if (close < 0) break;
      i = close + 2;
      continue;
    }
    if (ch === "\\" && text[i + 1] === "|") {
      i += 2;
      continue;
    }
    if (ch === "|") out.push(i);
    i += 1;
  }
  return out;
}

export function rowCells(text: string): string[] {
  const pipes = separatorPipes(text);
  if (!pipes.length) return [];
  const parts = [text.slice(0, pipes[0])];
  for (let i = 0; i < pipes.length - 1; i += 1) {
    parts.push(text.slice(pipes[i] + 1, pipes[i + 1]));
  }
  parts.push(text.slice(pipes[pipes.length - 1] + 1));
  if (parts[0]?.trim() === "") parts.shift();
  if (parts.length && parts[parts.length - 1]?.trim() === "") parts.pop();
  return parts;
}

function leadingSpaces(text: string): number {
  let i = 0;
  while (i < text.length && text[i] === " ") i += 1;
  return i;
}

function isFenceLine(text: string): { mark: string; len: number } | null {
  const match = FENCE_RE.exec(text);
  if (!match) return null;
  return { mark: match[2][0] ?? "`", len: match[2].length };
}

function isTableLine(text: string): boolean {
  if (leadingSpaces(text) >= 4) return false;
  return separatorPipes(text).length > 0;
}

function isDelimiterCell(cell: string): boolean {
  return DELIM_CELL_RE.test(cell) && cell.includes("-");
}

export function isDelimiterLine(text: string): boolean {
  if (!isTableLine(text)) return false;
  const cells = rowCells(text);
  return cells.length > 0 && cells.every(isDelimiterCell);
}

export function parseTables(lineCount: number, lineText: (line: number) => string): TableBlock[] {
  const tables: TableBlock[] = [];
  let fence: { mark: string; len: number } | null = null;
  let line = 1;
  while (line <= lineCount) {
    const text = lineText(line);
    const open = isFenceLine(text);
    if (open) {
      if (!fence) fence = open;
      else if (open.mark === fence.mark && open.len >= fence.len) fence = null;
      line += 1;
      continue;
    }
    if (fence) {
      line += 1;
      continue;
    }
    if (line < lineCount && isTableLine(text) && !isDelimiterLine(text) && isDelimiterLine(lineText(line + 1))) {
      const fromLine = line;
      const delimLine = line + 1;
      let toLine = delimLine;
      line += 2;
      while (line <= lineCount) {
        const body = lineText(line);
        if (isFenceLine(body) || !isTableLine(body)) break;
        toLine = line;
        line += 1;
      }
      tables.push({ fromLine, toLine, headerLine: fromLine, delimLine });
      continue;
    }
    line += 1;
  }
  return tables;
}

export function parseTablesFromSource(source: string): TableBlock[] {
  const lines = source.split("\n");
  return parseTables(lines.length, (number) => lines[number - 1] ?? "");
}

export const tableParser = {
  parse: parseTables,
  parseFromSource: parseTablesFromSource,
  scanNeeded: tableScanNeeded,
};
