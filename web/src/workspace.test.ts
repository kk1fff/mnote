import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyOpen,
  applyRoute,
  closeTab,
  collapseBeside,
  emptyWorkspace,
  forgetNote,
  layoutHref,
  loadWorkspace,
  openBeside,
  openInWorkspace,
  rememberTitle,
  resetWorkspace,
  setPinned,
  splitTabs,
  syncFavorites,
  UNPINNED_CAP,
  workspace,
} from "./workspace";

function stubDesktop(wide: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: wide && query.includes("721"),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
}

beforeEach(() => {
  stubDesktop(true);
  resetWorkspace(emptyWorkspace());
});

afterEach(() => {
  resetWorkspace(emptyWorkspace());
  vi.unstubAllGlobals();
});

describe("workspace", () => {
  it("replaces the unpinned active tab and activates an existing one", () => {
    applyOpen("a", "A");
    applyOpen("b", "B");
    expect(workspace.value.primary.tabs.map((tab) => tab.id)).toEqual(["b"]);
    applyOpen("c", "C");
    setPinned("c", true);
    applyOpen("d", "D");
    expect(workspace.value.primary.tabs.map((tab) => tab.id)).toEqual(["c", "d"]);
    applyOpen("c");
    expect(workspace.value.primary.active).toBe("c");
    expect(workspace.value.primary.tabs).toHaveLength(2);
  });

  it("pins without opening and close keeps the favorite", () => {
    applyOpen("a", "A");
    setPinned("a", true);
    applyOpen("b", "B");
    syncFavorites(["a"]);
    expect(workspace.value.primary.tabs.find((tab) => tab.id === "a")?.pinned).toBe(true);
    expect(workspace.value.primary.tabs.find((tab) => tab.id === "b")?.pinned).toBe(false);
    const next = closeTab("a", "primary");
    expect(next).toBe("b");
    expect(workspace.value.primary.tabs.map((tab) => tab.id)).toEqual(["b"]);
    syncFavorites(["a"]);
    expect(workspace.value.primary.tabs[0]?.pinned).toBe(false);
  });

  it("closes the last tab and hydrates from storage", () => {
    applyOpen("keep", "Keep");
    rememberTitle("keep", "Kept");
    expect(closeTab("keep", "primary")).toBeNull();
    applyOpen("one", "One");
    setPinned("one", true);
    applyOpen("two", "Two");
    const stored = loadWorkspace();
    expect(stored.primary.tabs.map((tab) => ({ id: tab.id, pinned: tab.pinned }))).toEqual([
      { id: "one", pinned: true },
      { id: "two", pinned: false },
    ]);
    expect(splitTabs(stored.primary).pinned.map((tab) => tab.id)).toEqual(["one"]);
  });

  it("evicts an extra unpinned tab", () => {
    applyOpen("seed", "Seed");
    setPinned("seed", true);
    for (let i = 0; i < UNPINNED_CAP + 1; i += 1) {
      applyOpen(`n${i}`, `N${i}`);
      applyOpen("seed");
    }
    const unpinned = workspace.value.primary.tabs.filter((tab) => !tab.pinned);
    expect(unpinned.length).toBe(UNPINNED_CAP);
    expect(workspace.value.primary.tabs.some((tab) => tab.id === "seed")).toBe(true);
  });

  it("opens beside on desktop and falls back on mobile", () => {
    applyOpen("a", "A");
    openBeside("b", "B");
    expect(workspace.value.beside?.active).toBe("b");
    expect(workspace.value.focused).toBe("beside");
    expect(layoutHref()).toBe("/n/b?beside=a");
    stubDesktop(false);
    expect(layoutHref()).toBe("/n/b");
    applyRoute("c", "d");
    expect(workspace.value.beside).toBeNull();
    expect(workspace.value.primary.active).toBe("c");
    expect(layoutHref()).toBe("/n/c");
  });

  it("restores a split from the route", () => {
    applyRoute("left", "right");
    expect(workspace.value.primary.active).toBe("left");
    expect(workspace.value.beside?.active).toBe("right");
    expect(workspace.value.focused).toBe("primary");
    expect(layoutHref()).toBe("/n/left?beside=right");
    workspace.value.focused = "beside";
    applyRoute("right", "left");
    expect(workspace.value.beside?.active).toBe("right");
    expect(workspace.value.primary.active).toBe("left");
    collapseBeside();
    expect(workspace.value.beside).toBeNull();
    expect(layoutHref()).toBe("/n/left");
  });

  it("adds a tab without replacing the unpinned active one", () => {
    applyOpen("a", "A");
    applyOpen("b", "B", "primary", true, "add");
    expect(workspace.value.primary.tabs.map((tab) => tab.id)).toEqual(["a", "b"]);
    expect(workspace.value.primary.active).toBe("b");
    applyOpen("a", "A", "primary", true, "add");
    expect(workspace.value.primary.active).toBe("a");
    expect(workspace.value.primary.tabs).toHaveLength(2);
    expect(openInWorkspace("c", "C", "add")).toBe("/n/c");
    expect(workspace.value.primary.tabs.map((tab) => tab.id)).toEqual(["a", "b", "c"]);
  });

  it("opens through the workspace and forgets a visible note", () => {
    applyOpen("a", "A");
    openBeside("b", "B");
    expect(openInWorkspace("c", "C")).toBe("/n/c?beside=a");
    expect(workspace.value.beside?.active).toBe("c");
    expect(forgetNote("c")).toBe("/n/a");
    expect(workspace.value.beside).toBeNull();
    expect(workspace.value.primary.active).toBe("a");
  });
});
