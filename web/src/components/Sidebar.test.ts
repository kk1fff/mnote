import { flushPromises, mount } from "@vue/test-utils";
import { createRouter, createWebHistory } from "vue-router";
import { describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { logout } from "../session";
import Sidebar from "./Sidebar.vue";

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return {
    ...actual,
    api: { listNotes: vi.fn() },
  };
});

vi.mock("../session", () => ({
  currentUser: { value: { username: "alice", must_change_password: false } },
  logout: vi.fn().mockResolvedValue(undefined),
}));

describe("Sidebar", () => {
  it("lists notes and searches", async () => {
    vi.mocked(api.listNotes).mockResolvedValue([
      { id: "o1", title: "One", folder: "ideas", modified_at: "" },
    ]);
    const router = createRouter({
      history: createWebHistory(),
      routes: [
        { path: "/", component: { template: "<div />" } },
        { path: "/search", component: { template: "<div />" } },
        { path: "/login", component: { template: "<div />" } },
        { path: "/password", component: { template: "<div />" } },
        { path: "/n/:id", component: { template: "<div />" } },
        { path: "/today", component: { template: "<div />" } },
      ],
    });
    await router.push("/");
    await router.isReady();
    const wrapper = mount(Sidebar, { global: { plugins: [router] } });
    await flushPromises();
    expect(wrapper.text()).toContain("ideas");
    expect(wrapper.text()).toContain("One");
    await wrapper.get('input[type="search"]').setValue("hello");
    await wrapper.get("form.search").trigger("submit");
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe("/search?q=hello");
    await wrapper.get(".sidebar-footer button.linkish").trigger("click");
    await flushPromises();
    expect(logout).toHaveBeenCalled();
    expect(router.currentRoute.value.path).toBe("/login");
  });

  it("opens the note picker", async () => {
    vi.mocked(api.listNotes).mockResolvedValue([]);
    const router = createRouter({
      history: createWebHistory(),
      routes: [
        { path: "/", component: { template: "<div />" } },
        { path: "/n/:id", component: { template: "<div />" } },
        { path: "/today", component: { template: "<div />" } },
      ],
    });
    await router.push("/");
    await router.isReady();
    const wrapper = mount(Sidebar, { global: { plugins: [router] } });
    await flushPromises();
    await wrapper.get(".new-note-button").trigger("click");
    expect(wrapper.emitted("open-picker")).toHaveLength(1);
  });
});
