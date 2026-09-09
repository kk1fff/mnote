import { flushPromises, mount } from "@vue/test-utils";
import { createRouter, createWebHistory } from "vue-router";
import { describe, expect, it, vi } from "vitest";
import { api } from "../api";
import NotesView from "./NotesView.vue";

vi.mock("../api", () => ({
  api: { listNotes: vi.fn() },
}));
vi.mock("../components/AppShell.vue", () => ({
  default: { template: '<div><slot :toggle="() => {}" /></div>' },
}));

describe("NotesView", () => {
  it("shows only regular notes and opens one", async () => {
    vi.mocked(api.listNotes).mockResolvedValue([
      { id: "daily", title: "2026-09-06", folder: "", modified_at: "2026-09-06T12:00:00Z" },
      { id: "note", title: "Project plan", folder: "work", modified_at: "2026-09-07T12:00:00Z" },
    ]);
    const router = createRouter({
      history: createWebHistory(),
      routes: [{ path: "/notes", component: NotesView }, { path: "/n/:id", component: { template: "<div />" } }],
    });
    await router.push("/notes");
    await router.isReady();
    const wrapper = mount(NotesView, { global: { plugins: [router] } });
    await flushPromises();
    expect(wrapper.text()).toContain("Project plan");
    expect(wrapper.text()).toContain("work");
    expect(wrapper.text()).not.toContain("2026-09-06");
    await wrapper.get('[data-testid="notes-entry"]').trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/n/note");
  });
});
