import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import { collapsed, refreshCollapsed, resetCollapsed, toggleCollapsed } from "./folders";

vi.mock("./api", () => ({
  api: {
    collapsedFolders: vi.fn(),
    collapseFolder: vi.fn(),
    expandFolder: vi.fn(),
  },
}));

describe("folders", () => {
  beforeEach(() => {
    resetCollapsed();
    vi.clearAllMocks();
  });

  it("loads collapsed folders", async () => {
    vi.mocked(api.collapsedFolders).mockResolvedValue(["ideas", "work/projects"]);
    await refreshCollapsed();
    expect([...collapsed.value]).toEqual(["ideas", "work/projects"]);
  });

  it("collapses and expands a folder", async () => {
    vi.mocked(api.collapseFolder).mockResolvedValue(undefined);
    vi.mocked(api.expandFolder).mockResolvedValue(undefined);
    await toggleCollapsed("ideas");
    expect(collapsed.value.has("ideas")).toBe(true);
    expect(api.collapseFolder).toHaveBeenCalledWith("ideas");
    await toggleCollapsed("ideas");
    expect(collapsed.value.has("ideas")).toBe(false);
    expect(api.expandFolder).toHaveBeenCalledWith("ideas");
  });

  it("reverts when persist fails", async () => {
    vi.mocked(api.collapseFolder).mockRejectedValue(new Error("offline"));
    await toggleCollapsed("ideas");
    expect(collapsed.value.has("ideas")).toBe(false);
  });
});
