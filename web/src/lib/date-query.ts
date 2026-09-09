import { padDate } from "./calendar";
import { todayDate } from "./paths";

const WEEKDAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
const MONTH_NAMES = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
] as const;
const RELATIVE = ["today", "tomorrow", "yesterday"] as const;

export type DateQueryContext = {
  now?: Date;
  shown?: { year: number; month: number };
};

export function isDayNumberQuery(raw: string): boolean {
  return /^\d{1,2}$/.test(raw.trim());
}

export function monthOf(date: string): { year: number; month: number } {
  const [year, month] = date.split("-").map(Number);
  return { year, month: month - 1 };
}

export function shiftIsoDate(date: string, days: number): string {
  const next = new Date(`${date}T12:00:00`);
  next.setDate(next.getDate() + days);
  return padDate(next.getFullYear(), next.getMonth(), next.getDate());
}

export function formatDateCandidate(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function parseDateQuery(raw: string, ctx: DateQueryContext = {}): string | null {
  const now = ctx.now ?? new Date();
  const q = raw.trim().toLowerCase();
  if (!q) return todayDate(now);

  const relative = uniquePrefix(RELATIVE, q);
  if (relative === "today") return todayDate(now);
  if (relative === "tomorrow") return shiftDays(now, 1);
  if (relative === "yesterday") return shiftDays(now, -1);

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(q);
  if (iso) return ymd(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const isoMonth = /^(\d{4})-(\d{1,2})-?$/.exec(q);
  if (isoMonth) return ymd(Number(isoMonth[1]), Number(isoMonth[2]), 1);

  const md = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(q);
  if (md) {
    let year = md[3] ? Number(md[3]) : undefined;
    if (year != null && year < 100) year += 2000;
    return mdThisOrNext(now, Number(md[1]), Number(md[2]), year);
  }

  const monthSlash = /^(\d{1,2})\/$/.exec(q);
  if (monthSlash) {
    const monthIndex = Number(monthSlash[1]) - 1;
    if (monthIndex < 0 || monthIndex > 11) return null;
    return monthFirst(now, monthIndex);
  }

  const nextPrefix = /^next\s+(.+)$/.exec(q);
  if (nextPrefix) {
    const named = uniquePrefix(WEEKDAY_NAMES, nextPrefix[1]);
    return named ? upcomingWeekday(now, WEEKDAY_NAMES.indexOf(named)) : null;
  }

  const weekday = uniquePrefix(WEEKDAY_NAMES, q);
  if (weekday) return upcomingWeekday(now, WEEKDAY_NAMES.indexOf(weekday));

  const monthName = uniquePrefix(MONTH_NAMES, q);
  if (monthName) return monthFirst(now, MONTH_NAMES.indexOf(monthName));

  if (isDayNumberQuery(q)) {
    const year = ctx.shown?.year ?? now.getFullYear();
    const month = (ctx.shown?.month ?? now.getMonth()) + 1;
    return ymd(year, month, Number(q));
  }

  return null;
}

function uniquePrefix<T extends string>(names: readonly T[], query: string): T | null {
  if (!query) return null;
  const hits = names.filter((name) => name.startsWith(query));
  return hits.length === 1 ? hits[0] : null;
}

function ymd(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1) return null;
  const next = new Date(year, month - 1, day);
  if (next.getFullYear() !== year || next.getMonth() !== month - 1 || next.getDate() !== day) return null;
  return padDate(year, month - 1, day);
}

function shiftDays(now: Date, days: number): string {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
  return padDate(next.getFullYear(), next.getMonth(), next.getDate());
}

function upcomingWeekday(now: Date, weekday: number): string {
  const delta = (weekday - now.getDay() + 7) % 7;
  return shiftDays(now, delta);
}

function mdThisOrNext(now: Date, month: number, day: number, year?: number): string | null {
  if (year != null) return ymd(year, month, day);
  const current = ymd(now.getFullYear(), month, day);
  if (!current) return null;
  if (current >= todayDate(now)) return current;
  return ymd(now.getFullYear() + 1, month, day);
}

function monthFirst(now: Date, monthIndex: number): string {
  const year = now.getMonth() > monthIndex ? now.getFullYear() + 1 : now.getFullYear();
  return padDate(year, monthIndex, 1);
}
