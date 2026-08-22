import { flushPromises, mount } from "@vue/test-utils";
import { createRouter, createWebHistory } from "vue-router";
import { describe, expect, it, vi } from "vitest";
import AppShell from "./AppShell.vue";

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return {
    ...actual,
    api: { listNotes: vi.fn().mockResolvedValue([]) },
  };
});

describe("AppShell", () => {
  it("opens the menu and closes it on navigation", async () => {
    const router = createRouter({
      history: createWebHistory(),
      routes: [
        { path: "/", component: { template: "<div />" } },
        { path: "/n/:path(.*)", component: { template: "<div />" } },
      ],
    });
    await router.push("/");
    await router.isReady();
    const wrapper = mount(AppShell, {
      global: { plugins: [router] },
      slots: {
        default: `<template #default="{ toggle }">
          <button class="open" @click="toggle">Menu</button>
        </template>`,
      },
    });
    await flushPromises();
    expect(wrapper.classes()).not.toContain("nav-open");
    await wrapper.get(".open").trigger("click");
    expect(wrapper.classes()).toContain("nav-open");
    await router.push("/n/2026-08-22");
    await flushPromises();
    expect(wrapper.classes()).not.toContain("nav-open");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "o", ctrlKey: true, shiftKey: true }));
    await flushPromises();
    expect(wrapper.find(".note-picker").exists()).toBe(true);
  });
});
