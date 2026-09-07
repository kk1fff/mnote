import { flushPromises, mount } from "@vue/test-utils";
import { createRouter, createWebHistory } from "vue-router";
import { describe, expect, it, vi } from "vitest";
import { api } from "../api";
import JournalView from "./JournalView.vue";

vi.mock("../api", () => ({
  api: { listNotes: vi.fn(), daily: vi.fn() },
}));
vi.mock("../components/AppShell.vue", () => ({
  default: { template: '<div><slot :toggle="() => {}" /></div>' },
}));
vi.mock("../components/SidebarCalendar.vue", () => ({
  default: { props: ["journalDates", "activeDate"], template: '<button data-testid="calendar-day" @click="$emit(\'select\', \'2026-09-06\')">calendar</button>' },
}));

describe("JournalView", () => {
  it("shows only daily notes and opens a selected date", async () => {
    vi.mocked(api.listNotes).mockResolvedValue([
      { id: "daily", title: "2026-09-06", folder: "", modified_at: "" },
      { id: "note", title: "Project plan", folder: "work", modified_at: "" },
    ]);
    vi.mocked(api.daily).mockResolvedValue({ id: "daily", title: "2026-09-06", content: "", modified_at: "" });
    const router = createRouter({
      history: createWebHistory(),
      routes: [{ path: "/journal", component: JournalView }, { path: "/n/:id", component: { template: "<div />" } }],
    });
    await router.push("/journal");
    await router.isReady();
    const wrapper = mount(JournalView, { global: { plugins: [router] } });
    await flushPromises();
    expect(wrapper.text()).toContain("Sun, Sep 6, 2026");
    expect(wrapper.text()).not.toContain("Project plan");
    await wrapper.get('[data-testid="calendar-day"]').trigger("click");
    await flushPromises();
    expect(api.daily).toHaveBeenCalledWith("2026-09-06");
    expect(router.currentRoute.value.path).toBe("/n/daily");
  });
});
