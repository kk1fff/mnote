import { describe, expect, it } from "vitest";
import { resetSidebarPrefs, sidebarPrefs, toggleSidebarSection } from "./sidebar";

describe("sidebar prefs", () => {
  it("toggles the folded rail", () => {
    resetSidebarPrefs();
    expect(sidebarPrefs.value.sidebarFolded).toBe(false);
    toggleSidebarSection("sidebarFolded");
    expect(sidebarPrefs.value.sidebarFolded).toBe(true);
    toggleSidebarSection("sidebarFolded");
    expect(sidebarPrefs.value.sidebarFolded).toBe(false);
    resetSidebarPrefs();
  });
});
