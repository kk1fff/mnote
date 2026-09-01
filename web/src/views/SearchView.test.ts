import { flushPromises, mount } from "@vue/test-utils";
import { createRouter, createWebHistory } from "vue-router";
import { describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { showParkedList } from "../parked";
import SearchView from "./SearchView.vue";

vi.mock("../parked", async () => {
  const actual = await vi.importActual<typeof import("../parked")>("../parked");
  return { ...actual, showParkedList: vi.fn() };
});

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return {
    ...actual,
    api: {
      listNotes: vi.fn().mockResolvedValue([]),
      listParked: vi.fn().mockResolvedValue([]),
      collapsedFolders: vi.fn().mockResolvedValue([]),
      search: vi.fn(),
    },
  };
});

describe("SearchView", () => {
  it("renders hits", async () => {
    vi.mocked(api.search).mockResolvedValue([
      { id: "o1", title: "One", snippet: "hello" },
    ]);
    const router = createRouter({
      history: createWebHistory(),
      routes: [
        { path: "/search", component: SearchView },
        { path: "/n/:id", component: { template: "<div />" } },
      ],
    });
    await router.push("/search?q=hello");
    await router.isReady();
    const wrapper = mount(SearchView, { global: { plugins: [router] } });
    await flushPromises();
    expect(wrapper.text()).toContain("One");
    expect(wrapper.text()).toContain("hello");
    expect(api.search).toHaveBeenCalledWith("hello", {});
  });

  it("forwards weather and near filters", async () => {
    vi.mocked(api.search).mockResolvedValue([]);
    const router = createRouter({
      history: createWebHistory(),
      routes: [{ path: "/search", component: SearchView }],
    });
    await router.push("/search?q=rain&weather=rain&near=1,2");
    await router.isReady();
    const wrapper = mount(SearchView, { global: { plugins: [router] } });
    await flushPromises();
    expect(api.search).toHaveBeenCalledWith("rain", { weather: "rain", near: "1,2" });
    expect(wrapper.get('[data-testid="search-weather"]').element).toBeTruthy();
  });

  it("shows search errors", async () => {
    vi.mocked(api.search).mockRejectedValue(new Error("boom"));
    const router = createRouter({
      history: createWebHistory(),
      routes: [{ path: "/search", component: SearchView }],
    });
    await router.push("/search?q=x");
    await router.isReady();
    const wrapper = mount(SearchView, { global: { plugins: [router] } });
    await flushPromises();
    expect(wrapper.text()).toContain("boom");
  });

  it("opens parked hits in the parked sheet", async () => {
    vi.mocked(api.search).mockResolvedValue([
      { id: "parked-7", title: "call jim", snippet: "#work", kind: "parked", parked_id: 7 },
    ]);
    const router = createRouter({
      history: createWebHistory(),
      routes: [{ path: "/search", component: SearchView }],
    });
    await router.push("/search?q=%23work");
    await router.isReady();
    const wrapper = mount(SearchView, { global: { plugins: [router] } });
    await flushPromises();
    await wrapper.get('[data-testid="search-hit"]').trigger("click");
    expect(showParkedList).toHaveBeenCalledWith(7);
  });
});
