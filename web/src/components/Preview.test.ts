import { mount } from "@vue/test-utils";
import { createRouter, createWebHistory } from "vue-router";
import { describe, expect, it } from "vitest";
import Preview from "./Preview.vue";

describe("Preview", () => {
  it("renders markdown and navigates wiki links", async () => {
    const router = createRouter({
      history: createWebHistory(),
      routes: [
        { path: "/", component: { template: "<div />" } },
        { path: "/n/:path(.*)", name: "note", component: { template: "<div />" } },
      ],
    });
    await router.push("/");
    await router.isReady();
    const wrapper = mount(Preview, {
      props: { source: "see [[ideas/one]]" },
      global: { plugins: [router] },
    });
    expect(wrapper.html()).toContain('href="/n/ideas/one"');
    expect(wrapper.get("a").attributes("data-wiki")).toBe("ideas/one");
  });
});
