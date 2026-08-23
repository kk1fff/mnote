import { afterEach, describe, expect, it } from "vitest";
import { applyTheme, cycleTheme, initTheme, setThemeMode, themeMode } from "./theme";

describe("theme", () => {
  afterEach(() => {
    themeMode.value = "system";
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-theme-mode");
  });

  it("applies an explicit mode", () => {
    setThemeMode("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.themeMode).toBe("dark");
  });

  it("cycles system, light, and dark", () => {
    themeMode.value = "system";
    cycleTheme();
    expect(themeMode.value).toBe("light");
    cycleTheme();
    expect(themeMode.value).toBe("dark");
    cycleTheme();
    expect(themeMode.value).toBe("system");
  });

  it("restores a stored mode", () => {
    setThemeMode("light");
    themeMode.value = "system";
    initTheme();
    expect(themeMode.value).toBe("light");
    expect(applyTheme()).toBe("light");
  });
});
