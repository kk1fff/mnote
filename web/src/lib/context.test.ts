import { afterEach, describe, expect, it } from "vitest";
import {
  deviceClass,
  formatWhereStamp,
  lineRange,
  rememberFix,
  resetGeoForTests,
  splitParagraphs,
  stamp,
} from "./context";
import { clearQueue, enqueue, loadQueue, newTmpId } from "./context-queue";

describe("context", () => {
  afterEach(() => {
    resetGeoForTests();
    clearQueue("n1");
  });

  it("splits paragraphs and ranges", () => {
    expect(splitParagraphs("a\n\nb")).toEqual(["a", "", "b"]);
    expect(lineRange("hello\nworld", 1)).toEqual({ from: 6, to: 11 });
  });

  it("formats /where without coordinates", () => {
    const text = formatWhereStamp(new Date("2026-08-23T21:05:00Z"), {
      weather_code: 1,
      weather_label: "partly cloudy",
      temp_c: 18.2,
    });
    expect(text).toContain("18°C");
    expect(text).toContain("partly cloudy");
    expect(text).not.toMatch(/lat|lon|-122/);
  });

  it("stamps last fix when fresh", () => {
    rememberFix({ lat: 37.77, lon: -122.42, accuracy_m: 8, at: Date.now() });
    const s = stamp("editor");
    expect(s.lat).toBe(37.77);
    expect(s.surface).toBe("editor");
    expect(["phone", "tablet", "desktop"]).toContain(s.device);
    expect(deviceClass(400)).toBe("phone");
  });

  it("persists a flush queue", () => {
    const event = { ...stamp("editor"), tmp_id: newTmpId(), ordinal: 0, source: "auto" as const };
    enqueue("n1", event);
    expect(loadQueue("n1")).toHaveLength(1);
    clearQueue("n1");
    expect(loadQueue("n1")).toEqual([]);
  });
});
