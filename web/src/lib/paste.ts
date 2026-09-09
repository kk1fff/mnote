export type PasteContext = {
  beforeCursor: string;
  afterCursor: string;
};

export type PasteState = {
  text: string;
  checkbox?: boolean;
};

export type PasteProcessor = {
  name: string;
  apply: (state: PasteState, ctx: PasteContext) => PasteState;
};

type ListKind = "bullet" | "ordered" | "task";

type ListPrefix = {
  raw: string;
  indent: string;
  kind: ListKind;
  checked?: boolean;
  bullet: string;
};

function parseLeadingMarker(line: string): ListPrefix | null {
  const task = /^(\s*)([-*+]\s+)\[([ xX])\](?:\s|$)/.exec(line);
  if (task) {
    return {
      raw: task[0],
      indent: task[1],
      kind: "task",
      checked: task[3] !== " ",
      bullet: task[2],
    };
  }
  const bullet = /^(\s*)([-*+]\s+)/.exec(line);
  if (bullet) {
    return { raw: bullet[0], indent: bullet[1], kind: "bullet", bullet: bullet[2] };
  }
  const ordered = /^(\s*)(\d+[.)]\s+)/.exec(line);
  if (ordered) {
    return { raw: ordered[0], indent: ordered[1], kind: "ordered", bullet: ordered[2] };
  }
  return null;
}

function parseListPrefix(text: string): ListPrefix | null {
  const marker = parseLeadingMarker(text);
  if (!marker || text.slice(marker.raw.length).trim() !== "") return null;
  return marker;
}

export function dedupeListPrefix(state: PasteState, ctx: PasteContext): PasteState {
  const current = parseListPrefix(ctx.beforeCursor);
  if (!current) return state;
  const first = state.text.split(/\r?\n/, 1)[0] ?? "";
  const rest = state.text.slice(first.length);
  const paste = parseLeadingMarker(first);
  if (!paste) return state;
  let stripLen = paste.raw.length;
  let checkbox = state.checkbox;
  if (current.kind === "task" && paste.kind === "task") {
    if (paste.checked !== current.checked) checkbox = paste.checked;
  } else if (current.kind !== "task" && paste.kind === "task") {
    stripLen = paste.indent.length + paste.bullet.length;
  }
  const text = first.slice(stripLen) + rest;
  if (text === state.text && checkbox === state.checkbox) return state;
  return checkbox === undefined ? { text } : { text, checkbox };
}

export const defaultProcessors: PasteProcessor[] = [
  { name: "dedupe-list-prefix", apply: dedupeListPrefix },
];

export function preprocessPaste(
  text: string,
  ctx: PasteContext,
  processors: PasteProcessor[] = defaultProcessors,
): PasteState {
  return processors.reduce((state, processor) => processor.apply(state, ctx), { text });
}
