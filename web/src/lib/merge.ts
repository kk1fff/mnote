export interface Merge {
  content: string;
  conflict: boolean;
}

export function threeWay(base: string, local: string, remote: string): Merge {
  if (local === remote) return { content: local, conflict: false };
  if (local === base) return { content: remote, conflict: false };
  if (remote === base) return { content: local, conflict: false };

  const baseLines = split(base);
  const localLines = split(local);
  const remoteLines = split(remote);
  if (baseLines.length * Math.max(localLines.length, remoteLines.length) > 1_500_000) {
    return {
      content: `<<<<<<< this device\n${local}\n=======\n${remote}\n>>>>>>> other device`,
      conflict: true,
    };
  }
  return applyMerge(baseLines, replaceHunks(baseLines, localLines), replaceHunks(baseLines, remoteLines));
}

function split(s: string): string[] {
  return s === "" ? [] : s.split("\n");
}

interface Hunk {
  start: number;
  end: number;
  lines: string[];
}

function lcsPairs(a: string[], b: string[]): Array<[number, number]> {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      dp[i + 1][j + 1] = a[i] === b[j] ? dp[i][j] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      pairs.push([i - 1, j - 1]);
      i -= 1;
      j -= 1;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i -= 1;
    } else {
      j -= 1;
    }
  }
  pairs.reverse();
  return pairs;
}

function replaceHunks(oldLines: string[], next: string[]): Hunk[] {
  const pairs: Array<[number, number]> = [[-1, -1], ...lcsPairs(oldLines, next), [oldLines.length, next.length]];
  const hunks: Hunk[] = [];
  for (let k = 0; k < pairs.length - 1; k++) {
    const [a0, b0] = pairs[k];
    const [a1, b1] = pairs[k + 1];
    const start = a0 + 1;
    const end = a1;
    const oldSlice = oldLines.slice(start, end);
    const newSlice = next.slice(b0 + 1, b1);
    if (oldSlice.join("\n") !== newSlice.join("\n")) {
      hunks.push({ start, end, lines: newSlice });
    }
  }
  return hunks;
}

function sliceWithHunks(base: string[], start: number, end: number, hunks: Hunk[]): string[] {
  let pos = start;
  const out: string[] = [];
  for (const hunk of hunks) {
    if (hunk.end <= start || hunk.start >= end) continue;
    const hStart = Math.max(hunk.start, start);
    const hEnd = Math.min(hunk.end, end);
    out.push(...base.slice(pos, hStart));
    if (hunk.start >= start && hunk.end <= end) out.push(...hunk.lines);
    else out.push(...base.slice(hStart, hEnd));
    pos = hEnd;
  }
  out.push(...base.slice(pos, end));
  return out;
}

function cluster(local: Hunk[], remote: Hunk[], i: number, j: number): [number, number, number, number] {
  let start = Number.POSITIVE_INFINITY;
  let end = 0;
  if (local[i]) {
    start = Math.min(start, local[i].start);
    end = Math.max(end, local[i].end);
  }
  if (remote[j]) {
    start = Math.min(start, remote[j].start);
    end = Math.max(end, remote[j].end);
  }
  let li = i;
  let ri = j;
  let grew = true;
  while (grew) {
    grew = false;
    while (li < local.length && local[li].start <= end) {
      end = Math.max(end, local[li].end);
      li += 1;
      grew = true;
    }
    while (ri < remote.length && remote[ri].start <= end) {
      end = Math.max(end, remote[ri].end);
      ri += 1;
      grew = true;
    }
  }
  return [start, end, li, ri];
}

function applyMerge(base: string[], local: Hunk[], remote: Hunk[]): Merge {
  let i = 0;
  let j = 0;
  let pos = 0;
  const out: string[] = [];
  let conflict = false;
  while (i < local.length || j < remote.length) {
    const ls = local[i]?.start ?? Number.POSITIVE_INFINITY;
    const rs = remote[j]?.start ?? Number.POSITIVE_INFINITY;
    if (ls < rs) {
      const hunk = local[i];
      if (hunk.end <= pos) {
        i += 1;
        continue;
      }
      if (remote[j] && remote[j].start < hunk.end) {
        const [start, end, li, ri] = cluster(local, remote, i, j);
        out.push(...base.slice(pos, start));
        const a = sliceWithHunks(base, start, end, local.slice(i, li));
        const b = sliceWithHunks(base, start, end, remote.slice(j, ri));
        if (a.join("\n") === b.join("\n")) out.push(...a);
        else {
          conflict = true;
          out.push("<<<<<<< this device", ...a, "=======", ...b, ">>>>>>> other device");
        }
        pos = end;
        i = li;
        j = ri;
      } else {
        out.push(...base.slice(pos, hunk.start), ...hunk.lines);
        pos = hunk.end;
        i += 1;
      }
    } else {
      const hunk = remote[j];
      if (hunk.end <= pos) {
        j += 1;
        continue;
      }
      if (local[i] && local[i].start < hunk.end) {
        const [start, end, li, ri] = cluster(local, remote, i, j);
        out.push(...base.slice(pos, start));
        const a = sliceWithHunks(base, start, end, local.slice(i, li));
        const b = sliceWithHunks(base, start, end, remote.slice(j, ri));
        if (a.join("\n") === b.join("\n")) out.push(...a);
        else {
          conflict = true;
          out.push("<<<<<<< this device", ...a, "=======", ...b, ">>>>>>> other device");
        }
        pos = end;
        i = li;
        j = ri;
      } else {
        out.push(...base.slice(pos, hunk.start), ...hunk.lines);
        pos = hunk.end;
        j += 1;
      }
    }
  }
  out.push(...base.slice(pos));
  return { content: out.join("\n"), conflict };
}
