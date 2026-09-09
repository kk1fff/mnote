import { describe, expect, it } from "vitest";
import {
  formatDateCandidate,
  isDayNumberQuery,
  monthOf,
  parseDateQuery,
  shiftIsoDate,
} from "./date-query";

const now = new Date(2026, 8, 13);

describe("date-query", () => {
  it("resolves empty, relative, and weekday phrases", () => {
    expect(parseDateQuery("", { now })).toBe("2026-09-13");
    expect(parseDateQuery("today", { now })).toBe("2026-09-13");
    expect(parseDateQuery("tomorrow", { now })).toBe("2026-09-14");
    expect(parseDateQuery("yesterday", { now })).toBe("2026-09-12");
    expect(parseDateQuery("mon", { now })).toBe("2026-09-14");
    expect(parseDateQuery("Monday", { now })).toBe("2026-09-14");
    expect(parseDateQuery("tue", { now })).toBe("2026-09-15");
    expect(parseDateQuery("sunday", { now })).toBe("2026-09-13");
    expect(parseDateQuery("next friday", { now })).toBe("2026-09-18");
    expect(parseDateQuery("t", { now })).toBeNull();
  });

  it("parses ISO, slash dates, month names, and day numbers", () => {
    expect(parseDateQuery("2026-09-14", { now })).toBe("2026-09-14");
    expect(parseDateQuery("2026-09", { now })).toBe("2026-09-01");
    expect(parseDateQuery("9/14", { now })).toBe("2026-09-14");
    expect(parseDateQuery("9/14/2026", { now })).toBe("2026-09-14");
    expect(parseDateQuery("9/", { now })).toBe("2026-09-01");
    expect(parseDateQuery("8/1", { now })).toBe("2027-08-01");
    expect(parseDateQuery("sep", { now })).toBe("2026-09-01");
    expect(parseDateQuery("october", { now })).toBe("2026-10-01");
    expect(parseDateQuery("august", { now })).toBe("2027-08-01");
    expect(parseDateQuery("14", { now, shown: { year: 2026, month: 8 } })).toBe("2026-09-14");
    expect(parseDateQuery("31", { now, shown: { year: 2026, month: 8 } })).toBeNull();
    expect(parseDateQuery("xyz", { now })).toBeNull();
    expect(parseDateQuery("2026-02-31", { now })).toBeNull();
  });

  it("formats and shifts candidates", () => {
    expect(formatDateCandidate("2026-09-14")).toBe("Monday, Sep 14, 2026");
    expect(shiftIsoDate("2026-09-14", 1)).toBe("2026-09-15");
    expect(monthOf("2026-09-14")).toEqual({ year: 2026, month: 8 });
    expect(isDayNumberQuery("14")).toBe(true);
    expect(isDayNumberQuery("9/14")).toBe(false);
  });
});
