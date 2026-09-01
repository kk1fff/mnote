import { mount } from "@vue/test-utils";
import { createRouter, createWebHistory } from "vue-router";
import { describe, expect, it, vi } from "vitest";
import { openTag } from "../lib/tags";
import Preview from "./Preview.vue";

vi.mock("../lib/tags", async () => {
  const actual = await vi.importActual<typeof import("../lib/tags")>("../lib/tags");
  return { ...actual, openTag: vi.fn() };
});

describe("Preview", () => {
  it("renders markdown and navigates wiki links", async () => {
    const router = createRouter({
      history: createWebHistory(),
      routes: [
        { path: "/", component: { template: "<div />" } },
        { path: "/n/:id", name: "note", component: { template: "<div />" } },
      ],
    });
    await router.push("/");
    await router.isReady();
    const wrapper = mount(Preview, {
      props: { source: "see [[ideas/one]]" },
      global: { plugins: [router] },
    });
    expect(wrapper.html()).toContain('href="/n/ideas%2Fone"');
    expect(wrapper.get("a").attributes("data-wiki")).toBe("ideas/one");
  });

  it("opens the picker from a hashtag", async () => {
    const wrapper = mount(Preview, { props: { source: "see #work" } });
    await wrapper.get("a[data-tag]").trigger("click");
    expect(openTag).toHaveBeenCalledWith("work");
  });
});
