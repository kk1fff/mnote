import { flushPromises, mount } from "@vue/test-utils";
import { createRouter, createWebHistory } from "vue-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { live } from "../live";
import NoteView from "./NoteView.vue";

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return {
    ...actual,
    api: {
      listNotes: vi.fn().mockResolvedValue([]),
      daily: vi.fn(),
      getNote: vi.fn(),
      putNote: vi.fn(),
      patchNote: vi.fn(),
      putDaily: vi.fn(),
      backlinks: vi.fn().mockResolvedValue([]),
      favorites: vi.fn().mockResolvedValue([]),
      favorite: vi.fn(),
      unfavorite: vi.fn(),
      logout: vi.fn(),
      listParked: vi.fn().mockResolvedValue([]),
      noteHistory: vi.fn().mockResolvedValue([]),
      noteRevision: vi.fn(),
      restoreNote: vi.fn(),
    },
  };
});

vi.mock("../live", () => ({
  live: {
    id: "test",
    connected: false,
    connect: vi.fn(),
    disconnect: vi.fn(),
    open: vi.fn(),
    change: vi.fn(),
    cursor: vi.fn(),
    push: vi.fn(),
    on: () => () => {},
  },
}));

vi.mock("../components/Editor.vue", () => ({
  default: {
    props: ["modelValue"],
    emits: ["update:modelValue"],
    template:
      '<textarea class="fake-editor" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
  },
}));

describe("NoteView", () => {
  afterEach(() => {
    vi.useRealTimers();
    live.connected = false;
  });

  it("loads a note and saves edits", async () => {
    vi.mocked(api.getNote).mockResolvedValue({
      id: "n1",
      title: "2026-08-22",
      content: "# 2026-08-22\n\n",
      modified_at: "",
    });
    vi.mocked(api.putNote).mockResolvedValue({
      id: "n1",
      title: "2026-08-22",
      content: "edited",
      modified_at: "",
    });
    const router = createRouter({
      history: createWebHistory(),
      routes: [
        { path: "/n/:id", component: NoteView },
        { path: "/today", component: { template: "<div />" } },
      ],
    });
    await router.push("/n/n1");
    await router.isReady();
    const wrapper = mount(NoteView, {
      global: { plugins: [router] },
    });
    await flushPromises();
    expect(api.getNote).toHaveBeenCalledWith("n1");
    await wrapper.get(".fake-editor").setValue("edited");
    await wrapper.get('[data-testid="save"]').trigger("click");
    await flushPromises();
    expect(api.putNote).toHaveBeenCalledWith("n1", "edited");
    await wrapper.get('[data-testid="preview-toggle"]').trigger("click");
    expect(wrapper.find(".preview").exists()).toBe(true);
  });

  it("autosaves after idle while live is connected", async () => {
    vi.useFakeTimers();
    live.connected = true;
    vi.mocked(api.putNote).mockClear();
    vi.mocked(api.getNote).mockResolvedValue({
      id: "n1",
      title: "2026-08-22",
      content: "# 2026-08-22\n\n",
      modified_at: "",
    });
    vi.mocked(api.putNote).mockResolvedValue({
      id: "n1",
      title: "2026-08-22",
      content: "edited",
      modified_at: "",
    });
    const router = createRouter({
      history: createWebHistory(),
      routes: [
        { path: "/n/:id", component: NoteView },
        { path: "/today", component: { template: "<div />" } },
      ],
    });
    await router.push("/n/n1");
    await router.isReady();
    const wrapper = mount(NoteView, { global: { plugins: [router] } });
    await flushPromises();
    await wrapper.get(".fake-editor").setValue("edited");
    expect(wrapper.text()).toContain("Editing");
    await vi.advanceTimersByTimeAsync(800);
    await flushPromises();
    expect(api.putNote).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("Saved");
  });

  it("shows an error when a note is missing", async () => {
    const { ApiError } = await import("../api");
    vi.mocked(api.getNote).mockRejectedValue(new ApiError(404, "not_found"));
    const router = createRouter({
      history: createWebHistory(),
      routes: [
        { path: "/n/:id", component: NoteView },
        { path: "/today", component: NoteView },
      ],
    });
    await router.push("/n/missing");
    await router.isReady();
    const wrapper = mount(NoteView, { global: { plugins: [router] } });
    await flushPromises();
    expect(api.getNote).toHaveBeenCalledWith("missing");
    expect(router.currentRoute.value.path).toBe("/n/missing");
    expect(wrapper.text()).toContain("Note not found");
  });

  it("renames from the header", async () => {
    vi.mocked(api.getNote).mockResolvedValue({
      id: "n1",
      title: "Old",
      folder: "ideas",
      content: "hi",
      modified_at: "",
    });
    vi.mocked(api.patchNote).mockResolvedValue({
      id: "n1",
      title: "New",
      folder: "work",
      content: "hi",
      modified_at: "",
    });
    const router = createRouter({
      history: createWebHistory(),
      routes: [
        { path: "/n/:id", component: NoteView },
        { path: "/today", component: { template: "<div />" } },
      ],
    });
    await router.push("/n/n1");
    await router.isReady();
    const wrapper = mount(NoteView, { global: { plugins: [router] } });
    await flushPromises();
    await wrapper.get('[data-testid="note-title"]').trigger("click");
    await wrapper.get('[data-testid="note-title-input"]').setValue("New");
    await wrapper.get('[data-testid="note-folder-input"]').setValue("work");
    await wrapper.get(".note-meta-form").trigger("submit");
    await flushPromises();
    expect(api.patchNote).toHaveBeenCalledWith("n1", { title: "New", folder: "work" });
    expect(wrapper.get('[data-testid="note-title"]').text()).toBe("New");
    expect(wrapper.get('[data-testid="note-folder"]').text()).toBe("work");
  });

  it("restores a history snapshot into the editor", async () => {
    vi.mocked(api.getNote).mockResolvedValue({
      id: "n1",
      title: "One",
      content: "newer",
      modified_at: "",
    });
    vi.mocked(api.noteHistory).mockResolvedValue([
      { rev: "r1", created_at: "2026-08-22T14:30:00Z", bytes: 4 },
    ]);
    vi.mocked(api.noteRevision).mockResolvedValue({
      rev: "r1",
      created_at: "2026-08-22T14:30:00Z",
      bytes: 4,
      title: "One",
      folder: "",
      content: "keep",
    });
    vi.mocked(api.restoreNote).mockResolvedValue({
      id: "n1",
      title: "One",
      content: "keep",
      modified_at: "",
    });
    const router = createRouter({
      history: createWebHistory(),
      routes: [
        { path: "/n/:id", component: NoteView },
        { path: "/today", component: { template: "<div />" } },
      ],
    });
    await router.push("/n/n1");
    await router.isReady();
    const wrapper = mount(NoteView, { global: { plugins: [router] } });
    await flushPromises();
    await wrapper.get('[data-testid="history"]').trigger("click");
    await flushPromises();
    await wrapper.get('[data-testid="history-row"]').trigger("click");
    await flushPromises();
    await wrapper.get('[data-testid="history-restore"]').trigger("click");
    await wrapper.get('[data-testid="history-restore"]').trigger("click");
    await flushPromises();
    expect(api.restoreNote).toHaveBeenCalledWith("n1", "r1");
    expect(wrapper.get(".fake-editor").element).toHaveProperty("value", "keep");
    expect(wrapper.get('[data-testid="note-status"]').text()).toBe("Restored");
  });
});

