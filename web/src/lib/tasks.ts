export const TASK_LINE_RE = /^(\s*)([-*+]\s+)\[([ xX])\](?:\s|$)/;

export type TaskChange = {
  from: number;
  to: number;
  insert: string;
  content: string;
};

export function taskBoxInLine(text: string): { from: number; checked: boolean } | null {
  const match = /^(\s*)([-*+]\s+)\[([ xX])\]/.exec(text);
  if (!match) return null;
  return { from: match[1].length + match[2].length, checked: match[3] !== " " };
}

export function lineAt(source: string, index: number): { from: number; text: string } | null {
  let from = 0;
  for (let i = 0; i < index; i += 1) {
    const nl = source.indexOf("\n", from);
    if (nl < 0) return null;
    from = nl + 1;
  }
  const nl = source.indexOf("\n", from);
  return { from, text: nl < 0 ? source.slice(from) : source.slice(from, nl) };
}

export function toggleTaskLine(source: string, lineIndex: number): TaskChange | null {
  const line = lineAt(source, lineIndex);
  if (!line || !TASK_LINE_RE.test(line.text)) return null;
  const box = taskBoxInLine(line.text);
  if (!box) return null;
  const inner = line.from + box.from + 1;
  const insert = box.checked ? " " : "x";
  return {
    from: inner,
    to: inner + 1,
    insert,
    content: `${source.slice(0, inner)}${insert}${source.slice(inner + 1)}`,
  };
}
