import { flushPromises, mount } from "@vue/test-utils";
import { createRouter, createWebHistory } from "vue-router";
import { describe, expect, it, vi } from "vitest";
import { api } from "../api";
import SearchView from "./SearchView.vue";

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return {
    ...actual,
    api: {
      listNotes: vi.fn().mockResolvedValue([]),
      search: vi.fn(),
    },
  };
});

describe("SearchView", () => {
  it("renders hits", async () => {
    vi.mocked(api.search).mockResolvedValue([
      { path: "ideas/one", title: "One", snippet: "hello" },
    ]);
    const router = createRouter({
      history: createWebHistory(),
      routes: [
        { path: "/search", component: SearchView },
        { path: "/n/:path(.*)", component: { template: "<div />" } },
      ],
    });
    await router.push("/search?q=hello");
    await router.isReady();
    const wrapper = mount(SearchView, { global: { plugins: [router] } });
    await flushPromises();
    expect(wrapper.text()).toContain("One");
    expect(wrapper.text()).toContain("hello");
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
});
