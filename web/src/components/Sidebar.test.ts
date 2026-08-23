import { flushPromises, mount } from "@vue/test-utils";
import { createRouter, createWebHistory } from "vue-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { live, type LiveEvent } from "../live";
import { logout } from "../session";
import Sidebar from "./Sidebar.vue";

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return {
    ...actual,
    api: { listNotes: vi.fn(), listParked: vi.fn().mockResolvedValue([]) },
  };
});

const liveHandlers: Array<(event: LiveEvent) => void> = [];

vi.mock("../live", () => ({
  live: {
    connect: vi.fn(),
    on: (handler: (event: LiveEvent) => void) => {
      liveHandlers.push(handler);
      return () => {
        const i = liveHandlers.indexOf(handler);
        if (i >= 0) liveHandlers.splice(i, 1);
      };
    },
  },
}));

vi.mock("../session", () => ({
  currentUser: { value: { username: "alice", must_change_password: false } },
  logout: vi.fn().mockResolvedValue(undefined),
}));

const { showParkCapture } = vi.hoisted(() => ({ showParkCapture: vi.fn() }));
vi.mock("../parked", async () => {
  const actual = await vi.importActual<typeof import("../parked")>("../parked");
  return { ...actual, showParkCapture };
});

describe("Sidebar", () => {
  afterEach(() => {
    showParkCapture.mockClear();
  });

  it("lists notes and signs out", async () => {
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
    expect(wrapper.get(".new-note-button").text()).toBe("Go to…");
    expect(wrapper.get('[data-testid="theme-toggle"]').text()).toContain("System");
    await wrapper.get('[data-testid="theme-toggle"]').trigger("click");
    expect(wrapper.get('[data-testid="theme-toggle"]').text()).toContain("Light");
    await wrapper.get(".sidebar-footer button.linkish").trigger("click");
    await flushPromises();
    expect(logout).toHaveBeenCalled();
    expect(router.currentRoute.value.path).toBe("/login");
  });

  it("opens park without a source note", async () => {
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
    await wrapper.get('[data-testid="sidebar-park"]').trigger("click");
    expect(showParkCapture).toHaveBeenCalledWith({});
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

  it("shows parked count", async () => {
    vi.mocked(api.listNotes).mockResolvedValue([]);
    vi.mocked(api.listParked).mockResolvedValue([
      { id: 1, body: "ask jim", created_at: "2026-08-22T15:00:00Z" },
    ]);
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
    expect(wrapper.get('[data-testid="parked-count"]').text()).toBe("1 parked");
    await wrapper.get('[data-testid="parked-count"]').trigger("click");
    expect(wrapper.emitted("open-parked")).toHaveLength(1);
  });

  it("upserts a live index note without refetching", async () => {
    liveHandlers.length = 0;
    vi.mocked(api.listNotes).mockResolvedValue([
      { id: "o1", title: "One", folder: "ideas", modified_at: "" },
    ]);
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
    vi.mocked(api.listNotes).mockClear();
    liveHandlers[0]({
      type: "index",
      note: { id: "t1", title: "Time", folder: "", modified_at: "" },
    });
    await flushPromises();
    expect(wrapper.text()).toContain("Time");
    expect(api.listNotes).not.toHaveBeenCalled();
    expect(live.connect).toHaveBeenCalled();
    liveHandlers[0]({ type: "deleted", id: "t1" });
    await flushPromises();
    expect(wrapper.text()).not.toContain("Time");
  });
});
