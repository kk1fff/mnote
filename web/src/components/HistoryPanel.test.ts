import { flushPromises, mount } from "@vue/test-utils";
import { createRouter, createWebHistory } from "vue-router";
import { describe, expect, it, vi } from "vitest";
import { api } from "../api";
import HistoryPanel from "./HistoryPanel.vue";

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return {
    ...actual,
    api: {
      noteHistory: vi.fn(),
      noteRevision: vi.fn(),
      restoreNote: vi.fn(),
      titleSearch: vi.fn().mockResolvedValue([]),
      createNote: vi.fn(),
    },
  };
});

async function mountPanel() {
  const router = createRouter({
    history: createWebHistory(),
    routes: [{ path: "/", component: { template: "<div />" } }],
  });
  await router.push("/");
  await router.isReady();
  return mount(HistoryPanel, {
    props: { noteId: "n1", current: "live body" },
    global: { plugins: [router] },
  });
}

describe("HistoryPanel", () => {
  it("previews a snapshot and restores it", async () => {
    vi.mocked(api.noteHistory).mockResolvedValue([
      { rev: "2026-08-22T14-30-00Z", created_at: "2026-08-22T14:30:00Z", bytes: 12 },
    ]);
    vi.mocked(api.noteRevision).mockResolvedValue({
      rev: "2026-08-22T14-30-00Z",
      created_at: "2026-08-22T14:30:00Z",
      bytes: 12,
      title: "One",
      folder: "ideas",
      content: "old body",
    });
    vi.mocked(api.restoreNote).mockResolvedValue({
      id: "n1",
      title: "One",
      content: "old body",
      modified_at: "",
    });
    const wrapper = await mountPanel();
    wrapper.vm.show();
    await flushPromises();
    expect(wrapper.get('[data-testid="history-panel"]').text()).toContain("Now");
    await wrapper.get('[data-testid="history-row"]').trigger("click");
    await flushPromises();
    expect(api.noteRevision).toHaveBeenCalledWith("n1", "2026-08-22T14-30-00Z");
    expect(wrapper.text()).toContain("old body");
    await wrapper.get('[data-testid="history-restore"]').trigger("click");
    expect(wrapper.get('[data-testid="history-restore"]').text()).toBe("Confirm restore");
    await wrapper.get('[data-testid="history-restore"]').trigger("click");
    await flushPromises();
    expect(api.restoreNote).toHaveBeenCalledWith("n1", "2026-08-22T14-30-00Z");
    expect(wrapper.emitted("restored")?.[0][0]).toMatchObject({ content: "old body" });
  });
});
