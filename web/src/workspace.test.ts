import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyOpen,
  closeTab,
  emptyWorkspace,
  loadWorkspace,
  rememberTitle,
  resetWorkspace,
  setPinned,
  splitTabs,
  syncFavorites,
  UNPINNED_CAP,
  workspace,
} from "./workspace";

beforeEach(() => {
  resetWorkspace(emptyWorkspace());
});

afterEach(() => {
  resetWorkspace(emptyWorkspace());
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
});
