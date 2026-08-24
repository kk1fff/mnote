import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { registerCapture, setParkContext } from "../parked";
import ParkCapture from "./ParkCapture.vue";

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return {
    ...actual,
    api: {
      createParked: vi.fn().mockResolvedValue({
        id: 1,
        body: "ask jim",
        created_at: "2026-08-22T15:00:00Z",
      }),
      listParked: vi.fn().mockResolvedValue([]),
    },
  };
});

describe("ParkCapture", () => {
  it("parks with source context", async () => {
    setParkContext(() => ({
      source_id: "n1",
      source_title: "Weekly",
      source_folder: "ideas",
      excerpt: "retry",
    }));
    const wrapper = mount(ParkCapture);
    await flushPromises();
    wrapper.vm.show();
    await flushPromises();
    expect(wrapper.get('[data-testid="park-capture"]').text()).toContain("Weekly");
    await wrapper.get('[data-testid="park-body"]').setValue("ask jim");
    await wrapper.get('[data-testid="park-save"]').trigger("click");
    await flushPromises();
    expect(api.createParked).toHaveBeenCalledWith(
      expect.objectContaining({
        body: "ask jim",
        source_id: "n1",
        source_title: "Weekly",
        source_folder: "ideas",
        excerpt: "retry",
        surface: "park",
      }),
    );
    expect(wrapper.find('[data-testid="park-capture"]').exists()).toBe(false);
    registerCapture(null);
    setParkContext(null);
  });
});
