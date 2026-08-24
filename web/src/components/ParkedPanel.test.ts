import { flushPromises, mount } from "@vue/test-utils";
import { createRouter, createWebHistory } from "vue-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { parkedItems } from "../parked";
import { emptyWorkspace, resetWorkspace } from "../workspace";
import ParkedPanel from "./ParkedPanel.vue";

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return {
    ...actual,
    api: {
      listParked: vi.fn(),
      parkedToNote: vi.fn(),
      deleteParked: vi.fn().mockResolvedValue(undefined),
    },
  };
});

describe("ParkedPanel", () => {
  afterEach(() => {
    parkedItems.value = [];
    resetWorkspace(emptyWorkspace());
  });

  it("makes a note from a parked thought", async () => {
    vi.mocked(api.listParked).mockResolvedValue([
      {
        id: 7,
        body: "ask jim",
        created_at: "2026-08-22T15:00:00Z",
        source_id: "n1",
        source_title: "Weekly",
      },
    ]);
    vi.mocked(api.parkedToNote).mockResolvedValue({
      id: "n2",
      title: "ask jim",
      content: "ask jim",
      modified_at: "",
    });
    vi.mocked(api.listParked).mockResolvedValueOnce([
      {
        id: 7,
        body: "ask jim",
        created_at: "2026-08-22T15:00:00Z",
        source_id: "n1",
        source_title: "Weekly",
      },
    ]);
    vi.mocked(api.listParked).mockResolvedValueOnce([]);
    const router = createRouter({
      history: createWebHistory(),
      routes: [
        { path: "/", component: { template: "<div />" } },
        { path: "/n/:id", component: { template: "<div />" } },
      ],
    });
    await router.push("/");
    await router.isReady();
    const wrapper = mount(ParkedPanel, { global: { plugins: [router] } });
    wrapper.vm.show();
    await flushPromises();
    await wrapper.get('[data-testid="parked-row"]').trigger("click");
    await wrapper.get('[data-testid="parked-make-note"]').trigger("click");
    await flushPromises();
    expect(api.parkedToNote).toHaveBeenCalledWith(7);
    expect(router.currentRoute.value.path).toBe("/n/n2");
  });
});
