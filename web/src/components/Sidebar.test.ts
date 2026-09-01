import { flushPromises, mount } from "@vue/test-utils";
import { createRouter, createWebHistory } from "vue-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { live, type LiveEvent } from "../live";
import { resetCollapsed } from "../folders";
import { todayDate } from "../lib/paths";
import { logout } from "../session";
import { resetSidebarPrefs } from "../sidebar";
import { emptyWorkspace, resetWorkspace } from "../workspace";
import Sidebar from "./Sidebar.vue";

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return {
    ...actual,
    api: {
      listNotes: vi.fn(),
      listParked: vi.fn().mockResolvedValue([]),
      collapsedFolders: vi.fn().mockResolvedValue([]),
      collapseFolder: vi.fn().mockResolvedValue(undefined),
      expandFolder: vi.fn().mockResolvedValue(undefined),
      backlinks: vi.fn().mockResolvedValue([]),
      deleteNote: vi.fn().mockResolvedValue(undefined),
      daily: vi.fn(),
    },
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
    vi.mocked(api.collapsedFolders).mockResolvedValue([]);
    resetCollapsed();
    resetSidebarPrefs();
    resetWorkspace(emptyWorkspace());
  });

  it("hides notes in collapsed folders", async () => {
    vi.mocked(api.listNotes).mockResolvedValue([
      { id: "o1", title: "One", folder: "ideas", modified_at: "" },
    ]);
    vi.mocked(api.collapsedFolders).mockResolvedValueOnce(["ideas"]);
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
    expect(wrapper.text()).toContain("ideas");
    expect(wrapper.text()).not.toContain("One");
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
    await wrapper.get('[data-testid="theme-toggle"]').trigger("click");
    expect(wrapper.get('[data-testid="theme-option-system"]').attributes("aria-checked")).toBe("true");
    await wrapper.get('[data-testid="theme-option-light"]').trigger("click");
    await wrapper.get('[data-testid="theme-toggle"]').trigger("click");
    expect(wrapper.get('[data-testid="theme-option-light"]').attributes("aria-checked")).toBe("true");
    await wrapper.get('[data-testid="account-menu"]').trigger("click");
    await wrapper.get('[data-testid="sign-out"]').trigger("click");
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
    expect(wrapper.get('[data-testid="parked-count"]').text()).toBe("1");
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

  it("deletes a note from the row menu", async () => {
    vi.mocked(api.listNotes).mockResolvedValue([
      { id: "o1", title: "One", folder: "ideas", modified_at: "" },
    ]);
    vi.mocked(api.backlinks).mockResolvedValue([
      { id: "n2", title: "Index", folder: "ideas", modified_at: "" },
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
    const wrapper = mount(Sidebar, { attachTo: document.body, global: { plugins: [router] } });
    await flushPromises();
    await wrapper.get('[data-testid="tree-more"]').trigger("click");
    await flushPromises();
    document.querySelector<HTMLButtonElement>('[data-testid="tree-delete"]')?.click();
    await flushPromises();
    expect(wrapper.get('[data-testid="delete-note"]').text()).toContain("ideas / Index");
    await wrapper.get('[data-testid="delete-note-confirm"]').trigger("click");
    await flushPromises();
    expect(api.deleteNote).toHaveBeenCalledWith("o1");
    expect(wrapper.text()).not.toContain("One");
    wrapper.unmount();
  });

  it("opens images and picker collections from Links", async () => {
    vi.mocked(api.listNotes).mockResolvedValue([]);
    const router = createRouter({
      history: createWebHistory(),
      routes: [
        { path: "/", component: { template: "<div />" } },
        { path: "/images", component: { template: "<div />" } },
        { path: "/n/:id", component: { template: "<div />" } },
        { path: "/today", component: { template: "<div />" } },
      ],
    });
    await router.push("/");
    await router.isReady();
    const wrapper = mount(Sidebar, { global: { plugins: [router] } });
    await flushPromises();
    expect(wrapper.text()).toContain("Links");
    expect(wrapper.text()).toContain("Images");
    expect(wrapper.text()).toContain("Favorites");
    expect(wrapper.text()).toContain("Recent");
    expect(wrapper.text()).toContain("Tags");
    await wrapper.get('[data-testid="sidebar-images"]').trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/images");
    await wrapper.get('[data-testid="sidebar-favorites"]').trigger("click");
    expect(wrapper.emitted("open-picker")?.at(-1)).toEqual(["favorites"]);
    await wrapper.get('[data-testid="sidebar-recent"]').trigger("click");
    expect(wrapper.emitted("open-picker")?.at(-1)).toEqual(["recent"]);
    await wrapper.get('[data-testid="sidebar-tags"]').trigger("click");
    expect(wrapper.emitted("open-picker")?.at(-1)).toEqual(["tags"]);
    await wrapper.get('[data-testid="sidebar-links-toggle"]').trigger("click");
    expect(wrapper.find('[data-testid="sidebar-images"]').exists()).toBe(false);
    wrapper.unmount();
    const again = mount(Sidebar, { global: { plugins: [router] } });
    await flushPromises();
    expect(again.find('[data-testid="sidebar-images"]').exists()).toBe(false);
    again.unmount();
  });

  it("creates a journal from the calendar", async () => {
    vi.mocked(api.listNotes).mockResolvedValue([
      { id: "d1", title: todayDate(), folder: "", modified_at: "" },
    ]);
    vi.mocked(api.daily).mockResolvedValue({
      id: "future",
      title: "2099-01-15",
      content: "# 2099-01-15\n\n",
      modified_at: "",
    });
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
    expect(wrapper.get(`[data-testid="cal-day-${todayDate()}"]`).classes()).toContain("journal");
    await wrapper.get('[data-testid="cal-next"]').trigger("click");
    await wrapper.get(".sidebar-cal-day").trigger("click");
    await flushPromises();
    expect(api.daily).toHaveBeenCalled();
    expect(router.currentRoute.value.path).toBe("/n/future");
  });

  it("leaves the open note after a sidebar delete", async () => {
    vi.mocked(api.listNotes).mockResolvedValue([
      { id: "o1", title: "One", folder: "", modified_at: "" },
    ]);
    vi.mocked(api.backlinks).mockResolvedValue([]);
    const router = createRouter({
      history: createWebHistory(),
      routes: [
        { path: "/", component: { template: "<div />" } },
        { path: "/n/:id", component: { template: "<div />" } },
        { path: "/today", component: { template: "<div />" } },
      ],
    });
    await router.push("/n/o1");
    await router.isReady();
    const wrapper = mount(Sidebar, { attachTo: document.body, global: { plugins: [router] } });
    await flushPromises();
    await wrapper.get('[data-testid="tree-more"]').trigger("click");
    await flushPromises();
    document.querySelector<HTMLButtonElement>('[data-testid="tree-delete"]')?.click();
    await flushPromises();
    await wrapper.get('[data-testid="delete-note-confirm"]').trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/today");
    wrapper.unmount();
  });
});
