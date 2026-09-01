import { describe, expect, it } from "vitest";
import { isDailyNote, monthCells, monthLabel, padDate, shiftMonth } from "./calendar";

describe("calendar", () => {
  it("detects root YYYY-MM-DD notes", () => {
    expect(isDailyNote({ title: "2026-08-31", folder: "" })).toBe(true);
    expect(isDailyNote({ title: "2026-08-31" })).toBe(true);
    expect(isDailyNote({ title: "2026-08-31", folder: "journal" })).toBe(false);
    expect(isDailyNote({ title: "Launch" })).toBe(false);
  });

  it("builds a Sunday-start August 2026 grid", () => {
    expect(padDate(2026, 7, 1)).toBe("2026-08-01");
    expect(monthLabel(2026, 7)).toBe("August 2026");
    const cells = monthCells(2026, 7);
    expect(cells).toHaveLength(42);
    expect(cells.filter((cell) => !cell.inMonth)).toHaveLength(11);
    expect(cells.find((cell) => cell.inMonth)?.date).toBe("2026-08-01");
    expect(cells.filter((cell) => cell.inMonth).at(-1)).toEqual({
      date: "2026-08-31",
      day: 31,
      inMonth: true,
    });
  });

  it("shifts months across years", () => {
    expect(shiftMonth(2026, 0, -1)).toEqual({ year: 2025, month: 11 });
    expect(shiftMonth(2026, 11, 1)).toEqual({ year: 2027, month: 0 });
  });
});
