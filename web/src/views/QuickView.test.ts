import { flushPromises, mount } from "@vue/test-utils";
import { createRouter, createWebHistory } from "vue-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { parkedItems } from "../parked";
import QuickView from "./QuickView.vue";

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return {
    ...actual,
    api: {
      listParked: vi.fn().mockResolvedValue([]),
      recentNotes: vi.fn().mockResolvedValue([
        { id: "n1", title: "Weekly", folder: "ideas", modified_at: "" },
      ]),
      createParked: vi.fn().mockResolvedValue({
        id: 1,
        body: "milk",
        created_at: "2026-08-22T15:00:00Z",
      }),
    },
  };
});

describe("QuickView", () => {
  afterEach(() => {
    parkedItems.value = [];
  });

  it("parks a dump", async () => {
    vi.mocked(api.listParked)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 1, body: "milk", created_at: "2026-08-22T15:00:00Z" },
      ]);
    const router = createRouter({
      history: createWebHistory(),
      routes: [{ path: "/quick", component: QuickView }],
    });
    await router.push("/quick");
    await router.isReady();
    const wrapper = mount(QuickView, { global: { plugins: [router] } });
    await flushPromises();
    await wrapper.get('[data-testid="quick-body"]').setValue("milk");
    await wrapper.get('[data-testid="quick-form"]').trigger("submit");
    await flushPromises();
    expect(api.createParked).toHaveBeenCalledWith({
      body: "milk",
      source_id: "n1",
      source_title: "Weekly",
      source_folder: "ideas",
    });
    expect(wrapper.get('[data-testid="quick-done"]').text()).toContain("1 waiting");
  });
});
