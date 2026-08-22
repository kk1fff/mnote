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
      putDaily: vi.fn(),
      backlinks: vi.fn().mockResolvedValue([]),
      favorites: vi.fn().mockResolvedValue([]),
      favorite: vi.fn(),
      unfavorite: vi.fn(),
      logout: vi.fn(),
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

  it("loads a daily note and saves edits", async () => {
    vi.mocked(api.daily).mockResolvedValue({
      path: "2026-08-22",
      content: "# 2026-08-22\n\n",
      modified_at: "",
    });
    vi.mocked(api.putDaily).mockResolvedValue({
      path: "2026-08-22",
      content: "edited",
      modified_at: "",
    });
    const router = createRouter({
      history: createWebHistory(),
      routes: [{ path: "/n/:path(.*)", component: NoteView }],
    });
    await router.push("/n/2026-08-22");
    await router.isReady();
    const wrapper = mount(NoteView, {
      global: { plugins: [router] },
    });
    await flushPromises();
    expect(api.daily).toHaveBeenCalledWith("2026-08-22");
    await wrapper.get(".fake-editor").setValue("edited");
    await wrapper.get('[data-testid="save"]').trigger("click");
    await flushPromises();
    expect(api.putDaily).toHaveBeenCalled();
    await wrapper.get('[data-testid="preview-toggle"]').trigger("click");
    expect(wrapper.find(".preview").exists()).toBe(true);
  });

  it("autosaves after idle while live is connected", async () => {
    vi.useFakeTimers();
    live.connected = true;
    vi.mocked(api.daily).mockResolvedValue({
      path: "2026-08-22",
      content: "# 2026-08-22\n\n",
      modified_at: "",
    });
    vi.mocked(api.putDaily).mockResolvedValue({
      path: "2026-08-22",
      content: "edited",
      modified_at: "",
    });
    const router = createRouter({
      history: createWebHistory(),
      routes: [{ path: "/n/:path(.*)", component: NoteView }],
    });
    await router.push("/n/2026-08-22");
    await router.isReady();
    const wrapper = mount(NoteView, { global: { plugins: [router] } });
    await flushPromises();
    await wrapper.get(".fake-editor").setValue("edited");
    expect(wrapper.text()).toContain("Editing");
    await vi.advanceTimersByTimeAsync(800);
    await flushPromises();
    expect(api.putDaily).toHaveBeenCalled();
    expect(wrapper.text()).toContain("Saved");
  });

  it("opens a missing page as a new note", async () => {
    const { ApiError } = await import("../api");
    vi.mocked(api.getNote).mockRejectedValue(new ApiError(404, "not_found"));
    const router = createRouter({
      history: createWebHistory(),
      routes: [{ path: "/n/:path(.*)", component: NoteView }],
    });
    await router.push("/n/ideas/one");
    await router.isReady();
    mount(NoteView, { global: { plugins: [router] } });
    await flushPromises();
    expect(api.getNote).toHaveBeenCalledWith("ideas/one");
  });
});
