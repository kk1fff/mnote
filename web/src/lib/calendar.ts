export const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"] as const;

const DAILY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDailyNote(note: { title: string; folder?: string | null }): boolean {
  return !(note.folder ?? "") && DAILY_RE.test(note.title);
}

export function padDate(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function monthLabel(year: number, month: number): string {
  return new Date(year, month, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
}

export type CalendarCell = {
  date: string;
  day: number;
  inMonth: boolean;
};

export function monthCells(year: number, month: number): CalendarCell[] {
  const pad = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  const cells: CalendarCell[] = [];
  for (let i = 0; i < pad; i++) cells.push({ date: "", day: 0, inMonth: false });
  for (let day = 1; day <= days; day++) {
    cells.push({ date: padDate(year, month, day), day, inMonth: true });
  }
  while (cells.length < 42) cells.push({ date: "", day: 0, inMonth: false });
  return cells;
}

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const next = new Date(year, month + delta, 1);
  return { year: next.getFullYear(), month: next.getMonth() };
}
