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
    },
  };
});

async function openPicker() {
  const router = createRouter({
    history: createWebHistory(),
    routes: [
      { path: "/", component: { template: "<div />" } },
      { path: "/n/:path(.*)", component: { template: "<div />" } },
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
  });

  it("keeps create available when a partial match exists", async () => {
    vi.useFakeTimers();
    vi.mocked(api.titleSearch).mockResolvedValue([
      { path: "work/plan", title: "Plan", modified_at: "" },
    ]);
    const { wrapper } = await openPicker();
    await wrapper.get("input").setValue("plan");
    await vi.advanceTimersByTimeAsync(120);
    await flushPromises();
    expect(wrapper.text()).toContain("work/plan");
    expect(wrapper.text()).toContain("Create “plan”");
    expect(wrapper.text()).toMatch(/⌘↵ create|Ctrl\+↵ create/);
  });

  it("hides create for an exact path and creates with the shortcut", async () => {
    vi.useFakeTimers();
    vi.mocked(api.titleSearch).mockResolvedValue([
      { path: "work/plan", title: "Plan", modified_at: "" },
    ]);
    vi.mocked(api.createNote).mockResolvedValue({
      path: "plan",
      content: "",
      modified_at: "",
    });
    const { wrapper, router } = await openPicker();
    await wrapper.get("input").setValue("work/plan");
    await vi.advanceTimersByTimeAsync(120);
    await flushPromises();
    expect(wrapper.text()).not.toContain("Create “work/plan”");

    await wrapper.get("input").setValue("plan");
    await vi.advanceTimersByTimeAsync(120);
    await flushPromises();
    await wrapper.get("input").trigger("keydown", { key: "Enter", metaKey: true });
    await flushPromises();
    expect(api.createNote).toHaveBeenCalledWith("plan");
    expect(router.currentRoute.value.path).toBe("/n/plan");
  });

  it("treats a trailing slash as folder browse", async () => {
    vi.useFakeTimers();
    vi.mocked(api.titleSearch).mockResolvedValue([
      { path: "ideas/one", title: "One", modified_at: "" },
    ]);
    const { wrapper } = await openPicker();
    await wrapper.get("input").setValue("ideas/");
    await vi.advanceTimersByTimeAsync(120);
    await flushPromises();
    expect(wrapper.text()).toContain("ideas/one");
    expect(wrapper.text()).toContain("Type a name to create in ideas/");
    expect(wrapper.find(".picker-create").exists()).toBe(false);
    expect(wrapper.text()).not.toMatch(/⌘↵ create|Ctrl\+↵ create/);
  });
});
