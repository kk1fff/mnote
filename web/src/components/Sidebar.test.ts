import { flushPromises, mount } from "@vue/test-utils";
import { createRouter, createWebHistory } from "vue-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { live, type LiveEvent } from "../live";
import { resetCollapsed } from "../folders";
import { todayDate } from "../lib/paths";
import { logout } from "../session";
import { resetSidebarPrefs } from "../sidebar";

const desktopState = { flavor: null as "full" | "remote" | null, folder: "/tmp/notes-vault" };
vi.mock("../desktop", () => ({
  flavor: () => desktopState.flavor,
  desktopInfo: () =>
    desktopState.flavor === "full"
      ? {
          flavor: "full" as const,
          apiBase: "http://127.0.0.1:1",
          folder: desktopState.folder,
          username: null,
          needsSetup: false,
        }
      : null,
}));
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
    desktopState.flavor = null;
    showParkCapture.mockClear();
    vi.mocked(api.collapsedFolders).mockResolvedValue([]);
    resetCollapsed();
    resetSidebarPrefs();
    resetWorkspace(emptyWorkspace());
  });

  it("lists recent notes and a notes tree", async () => {
    vi.mocked(api.listNotes).mockResolvedValue([
      { id: "o1", title: "One", folder: "ideas", modified_at: "2026-01-01" },
      { id: "d1", title: todayDate(), folder: "", modified_at: "2026-12-31" },
      { id: "n2", title: "Two", folder: "", modified_at: "2026-01-02" },
      { id: "n3", title: "Three", folder: "", modified_at: "2026-01-03" },
      { id: "n4", title: "Four", folder: "", modified_at: "2026-01-04" },
      { id: "n5", title: "Five", folder: "", modified_at: "2026-01-05" },
      { id: "n6", title: "Six", folder: "", modified_at: "2026-01-06" },
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
    expect(wrapper.findAll(".recent-note")).toHaveLength(5);
    expect(wrapper.get('[data-testid="tree-folder"]').text()).toContain("ideas");
    expect(wrapper.findAll(".tree-link").map((node) => node.text())).not.toContain(todayDate());
    expect(wrapper.get('[data-testid="new-note"]').text()).toContain("New note");
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
    expect(wrapper.text()).toContain("One");
    expect(wrapper.get(".new-note-button").text()).toContain("Search notes");
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

  it("hides account controls on the local app", async () => {
    desktopState.flavor = "full";
    vi.mocked(api.listNotes).mockResolvedValue([]);
    window.mnote = {
      flavor: "full",
      ready: vi.fn(),
      setServer: vi.fn(),
      pickFolder: vi.fn(),
      setup: vi.fn(),
      revealFolder: vi.fn().mockResolvedValue(true),
      getToken: vi.fn(),
      setToken: vi.fn(),
    };
    const router = createRouter({
      history: createWebHistory(),
      routes: [
        { path: "/", component: { template: "<div />" } },
        { path: "/setup", component: { template: "<div />" } },
        { path: "/today", component: { template: "<div />" } },
      ],
    });
    await router.push("/");
    await router.isReady();
    const wrapper = mount(Sidebar, { global: { plugins: [router] } });
    await flushPromises();
    expect(wrapper.find('[data-testid="account-menu"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="sign-out"]').exists()).toBe(false);
    await wrapper.get('[data-testid="folder-menu"]').trigger("click");
    expect(wrapper.text()).toContain("Show in folder");
    await wrapper.get('[data-testid="change-folder"]').trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/setup");
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

  it("opens library and organize destinations", async () => {
    vi.mocked(api.listNotes).mockResolvedValue([]);
    const router = createRouter({
      history: createWebHistory(),
      routes: [
        { path: "/", component: { template: "<div />" } },
        { path: "/images", component: { template: "<div />" } },
        { path: "/notes", component: { template: "<div />" } },
        { path: "/journal", component: { template: "<div />" } },
        { path: "/n/:id", component: { template: "<div />" } },
        { path: "/today", component: { template: "<div />" } },
      ],
    });
    await router.push("/");
    await router.isReady();
    const wrapper = mount(Sidebar, { global: { plugins: [router] } });
    await flushPromises();
    expect(wrapper.text()).toContain("Library");
    expect(wrapper.text()).toContain("Organize");
    expect(wrapper.text()).toContain("Images");
    expect(wrapper.text()).toContain("Favorites");
    expect(wrapper.text()).toContain("Tags");
    expect(wrapper.find('.library-group [data-testid="sidebar-notes"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="sidebar-notes-rail"]').exists()).toBe(true);
    await wrapper.get('[data-testid="sidebar-notes"]').trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/notes");
    await wrapper.get('[data-testid="sidebar-images"]').trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/images");
    await wrapper.get('[data-testid="sidebar-journal"]').trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/journal");
    await wrapper.get('[data-testid="sidebar-favorites"]').trigger("click");
    expect(wrapper.emitted("open-picker")?.at(-1)).toEqual(["favorites"]);
    await wrapper.get('[data-testid="sidebar-tags"]').trigger("click");
    expect(wrapper.emitted("open-picker")?.at(-1)).toEqual(["tags"]);
    wrapper.unmount();
  });

  it("collapses a folder in the notes tree", async () => {
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
    await wrapper.get('[data-testid="tree-folder"]').trigger("click");
    await flushPromises();
    expect(api.collapseFolder).toHaveBeenCalledWith("ideas");
    wrapper.unmount();
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
