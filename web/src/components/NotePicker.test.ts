import { flushPromises, mount } from "@vue/test-utils";
import { createRouter, createWebHistory } from "vue-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { applyOpen, emptyWorkspace, resetWorkspace, workspace } from "../workspace";
import NotePicker from "./NotePicker.vue";

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return {
    ...actual,
    api: {
      titleSearch: vi.fn(),
      createNote: vi.fn(),
      listNotes: vi.fn(),
      recentNotes: vi.fn(),
      favorites: vi.fn(),
      search: vi.fn(),
    },
  };
});

async function openPicker(mode: "replace" | "add" = "replace") {
  const router = createRouter({
    history: createWebHistory(),
    routes: [
      { path: "/", component: { template: "<div />" } },
      { path: "/n/:id", component: { template: "<div />" } },
      { path: "/today", component: { template: "<div />" } },
      { path: "/recent", component: { template: "<div />" } },
      { path: "/favorites", component: { template: "<div />" } },
    ],
  });
  await router.push("/");
  await router.isReady();
  const wrapper = mount(NotePicker, { global: { plugins: [router] } });
  wrapper.vm.show(mode);
  await flushPromises();
  return { wrapper, router };
}

describe("NotePicker", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(api.titleSearch).mockReset();
    vi.mocked(api.createNote).mockReset();
    vi.mocked(api.listNotes).mockReset();
    vi.mocked(api.recentNotes).mockReset();
    vi.mocked(api.favorites).mockReset();
    vi.mocked(api.search).mockReset();
    resetWorkspace(emptyWorkspace());
  });

  it("keeps create available when a partial match exists", async () => {
    vi.useFakeTimers();
    vi.mocked(api.titleSearch).mockResolvedValue([
      { id: "p1", title: "Plan", folder: "work", modified_at: "" },
    ]);
    const { wrapper } = await openPicker();
    await wrapper.get("input").setValue("pla");
    await vi.advanceTimersByTimeAsync(120);
    await flushPromises();
    expect(wrapper.text()).toContain("Note");
    expect(wrapper.text()).toContain("Create");
    expect(wrapper.text()).toContain("Plan");
    expect(wrapper.text()).toContain("work");
    expect(wrapper.text()).toContain("Create “pla”");
    expect(wrapper.text()).toMatch(/⌘↵ create|Ctrl\+↵ create/);
  });

  it("hides create for an exact folder path and creates with the shortcut", async () => {
    vi.useFakeTimers();
    vi.mocked(api.titleSearch).mockResolvedValue([
      { id: "p1", title: "Plan", folder: "work", modified_at: "" },
    ]);
    vi.mocked(api.createNote).mockResolvedValue({
      id: "new1",
      title: "plan",
      content: "",
      modified_at: "",
    });
    const { wrapper, router } = await openPicker();
    await wrapper.get("input").setValue("work/Plan");
    await vi.advanceTimersByTimeAsync(120);
    await flushPromises();
    expect(wrapper.text()).not.toContain("Create “work/Plan”");

    await wrapper.get("input").setValue("draft");
    await vi.advanceTimersByTimeAsync(120);
    await flushPromises();
    await wrapper.get("input").trigger("keydown", { key: "Enter", metaKey: true });
    await flushPromises();
    expect(api.createNote).toHaveBeenCalledWith("draft", "");
    expect(router.currentRoute.value.path).toBe("/n/new1");
  });

  it("treats a trailing slash as folder browse", async () => {
    vi.useFakeTimers();
    vi.mocked(api.titleSearch).mockResolvedValue([
      { id: "o1", title: "One", folder: "ideas", modified_at: "" },
    ]);
    const { wrapper } = await openPicker();
    await wrapper.get("input").setValue("ideas/");
    await vi.advanceTimersByTimeAsync(120);
    await flushPromises();
    expect(wrapper.text()).toContain("One");
    expect(wrapper.text()).toContain("Type a name to create in ideas/");
    expect(wrapper.find(".picker-create").exists()).toBe(false);
    expect(wrapper.text()).not.toMatch(/⌘↵ create|Ctrl\+↵ create/);
  });

  it("opens Today from the empty picker", async () => {
    const { wrapper, router } = await openPicker();
    expect(wrapper.text()).toContain("Go to");
    expect(wrapper.text()).toContain("Today");
    await wrapper.get(".picker-results button").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/today");
    expect(wrapper.find('[data-testid="picker"]').exists()).toBe(false);
  });

  it("lists recent notes in the picker and goes back", async () => {
    vi.mocked(api.recentNotes).mockResolvedValue([
      { id: "r1", title: "Opened", folder: "work", modified_at: "" },
    ]);
    const { wrapper, router } = await openPicker();
    await wrapper.get('[data-testid="picker-recent"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-testid="picker"]').exists()).toBe(true);
    expect(router.currentRoute.value.path).toBe("/");
    expect(wrapper.text()).toContain("Opened");
    expect(wrapper.text()).toContain("work");
    expect(wrapper.text()).toContain("← Go to");
    await wrapper.get('[data-testid="picker-back"]').trigger("click");
    expect(wrapper.find('[data-testid="picker-recent"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("Go to");
  });

  it("opens a collection from show()", async () => {
    vi.mocked(api.favorites).mockResolvedValue([
      { id: "f1", title: "Starred", folder: "", modified_at: "" },
    ]);
    const { wrapper, router } = await openPicker();
    wrapper.vm.show("replace", "favorites");
    await flushPromises();
    expect(wrapper.text()).toContain("Starred");
    expect(wrapper.find('[data-testid="picker-back"]').exists()).toBe(true);
    expect(router.currentRoute.value.path).toBe("/");
  });

  it("returns from favorites with Escape", async () => {
    vi.mocked(api.favorites).mockResolvedValue([
      { id: "f1", title: "Starred", folder: "", modified_at: "" },
    ]);
    const { wrapper, router } = await openPicker();
    await wrapper.get('[data-testid="picker-favorites"]').trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("Starred");
    expect(router.currentRoute.value.path).toBe("/");
    await wrapper.get("input").trigger("keydown", { key: "Escape" });
    expect(wrapper.find('[data-testid="picker"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="picker-favorites"]').exists()).toBe(true);
  });

  it("enters folder search and fills the folder prefix", async () => {
    vi.mocked(api.listNotes).mockResolvedValue([
      { id: "o1", title: "One", folder: "ideas", modified_at: "" },
    ]);
    const { wrapper } = await openPicker();
    expect(wrapper.text()).toContain("Folder");
    expect(wrapper.get('[data-testid="picker-search-folder"]').text()).toContain("Search folder");
    await wrapper.get('[data-testid="picker-search-folder"]').trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("ideas");
    await wrapper.get("input").trigger("keydown", { key: "Escape" });
    expect(wrapper.find('[data-testid="picker"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="picker-search-folder"]').exists()).toBe(true);
    await wrapper.get('[data-testid="picker-search-folder"]').trigger("click");
    await flushPromises();
    await wrapper.get(".picker-results button").trigger("click");
    expect((wrapper.get("input").element as HTMLInputElement).value).toBe("ideas/");
  });

  it("treats ! as folder search without calling title search", async () => {
    vi.mocked(api.listNotes).mockResolvedValue([
      { id: "o1", title: "One", folder: "ideas", modified_at: "" },
      { id: "o2", title: "Two", folder: "work", modified_at: "" },
    ]);
    const { wrapper } = await openPicker();
    await wrapper.get("input").setValue("!");
    await flushPromises();
    expect(api.titleSearch).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("ideas");
    expect(wrapper.text()).toContain("work");
    await wrapper.get("input").setValue("!ide");
    await flushPromises();
    expect(wrapper.text()).toContain("ideas");
    expect(wrapper.text()).not.toContain("work");
    expect(api.titleSearch).not.toHaveBeenCalled();
  });

  it("searches titles inside a folder path", async () => {
    vi.useFakeTimers();
    vi.mocked(api.titleSearch).mockResolvedValue([
      { id: "o1", title: "Alpha", folder: "ideas", modified_at: "" },
    ]);
    const { wrapper } = await openPicker();
    await wrapper.get("input").setValue("ideas/alp");
    await vi.advanceTimersByTimeAsync(120);
    await flushPromises();
    expect(api.titleSearch).toHaveBeenCalledWith("ideas/alp");
    expect(wrapper.text()).toContain("Alpha");
    expect(wrapper.text()).toContain("Create “ideas/alp”");
  });

  it("adds a tab when opened in add mode", async () => {
    vi.useFakeTimers();
    applyOpen("keep", "Keep");
    vi.mocked(api.titleSearch).mockResolvedValue([
      { id: "n2", title: "Next", folder: "", modified_at: "" },
    ]);
    const { wrapper } = await openPicker("add");
    await wrapper.get("input").setValue("Next");
    await vi.advanceTimersByTimeAsync(120);
    await flushPromises();
    await wrapper.get(".picker-results button").trigger("click");
    await flushPromises();
    expect(workspace.value.primary.tabs.map((tab) => tab.id)).toEqual(["keep", "n2"]);
    expect(workspace.value.primary.active).toBe("n2");
  });

  it("opens tags from Links and lists lines for an exact tag", async () => {
    vi.mocked(api.listNotes).mockResolvedValue([
      { id: "o1", title: "One", folder: "ideas", modified_at: "", tags: ["work"] },
    ]);
    vi.mocked(api.search).mockResolvedValue([
      { id: "o1", title: "One", snippet: "see #work", line: 2, from: 4, to: 9 },
    ]);
    const { wrapper } = await openPicker();
    await wrapper.get('[data-testid="picker-tags"]').trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("#work");
    await wrapper.get('[data-testid="picker-tag-work"]').trigger("click");
    await flushPromises();
    expect((wrapper.get("input").element as HTMLInputElement).value).toBe("#work");
    expect(wrapper.get('[data-testid="picker-tag-hit"]').text()).toContain("One");
    expect(wrapper.get('[data-testid="picker-tag-hit"]').text()).toContain("L2");
    expect(wrapper.get('[data-testid="picker-tag-hit"]').text()).toContain("see #work");
  });
});
