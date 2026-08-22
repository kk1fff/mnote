import { flushPromises, mount } from "@vue/test-utils";
import { createRouter, createWebHistory } from "vue-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import NotePicker from "./NotePicker.vue";

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return {
    ...actual,
    api: {
      titleSearch: vi.fn(),
      createNote: vi.fn(),
      listNotes: vi.fn(),
    },
  };
});

async function openPicker() {
  const router = createRouter({
    history: createWebHistory(),
    routes: [
      { path: "/", component: { template: "<div />" } },
      { path: "/n/:id", component: { template: "<div />" } },
    ],
  });
  await router.push("/");
  await router.isReady();
  const wrapper = mount(NotePicker, { global: { plugins: [router] } });
  wrapper.vm.show();
  await flushPromises();
  return { wrapper, router };
}

describe("NotePicker", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(api.titleSearch).mockReset();
    vi.mocked(api.createNote).mockReset();
    vi.mocked(api.listNotes).mockReset();
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
    expect(wrapper.text()).toContain("Plan");
    expect(wrapper.text()).toContain("work");
    expect(wrapper.text()).toContain("Create “pla”");
    expect(wrapper.text()).toMatch(/⌘↵ create|Ctrl\+↵ create/);
  });

  it("hides create for an exact title and creates with the shortcut", async () => {
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
    await wrapper.get("input").setValue("Plan");
    await vi.advanceTimersByTimeAsync(120);
    await flushPromises();
    expect(wrapper.text()).not.toContain("Create “Plan”");

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

  it("enters folder search and fills the folder prefix", async () => {
    vi.mocked(api.listNotes).mockResolvedValue([
      { id: "o1", title: "One", folder: "ideas", modified_at: "" },
    ]);
    const { wrapper } = await openPicker();
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
});
