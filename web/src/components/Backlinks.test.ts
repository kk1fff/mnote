import { mount } from "@vue/test-utils";
import { createRouter, createWebHistory } from "vue-router";
import { describe, expect, it } from "vitest";
import Backlinks from "./Backlinks.vue";

describe("Backlinks", () => {
  it("shows empty state and links", async () => {
    const router = createRouter({
      history: createWebHistory(),
      routes: [{ path: "/n/:path(.*)", component: { template: "<div />" } }],
    });
    await router.push("/");
    await router.isReady();
    const empty = mount(Backlinks, {
      props: { links: [] },
      global: { plugins: [router] },
    });
    expect(empty.text()).toContain("No backlinks");
    const filled = mount(Backlinks, {
      props: { links: [{ path: "a", title: "A", modified_at: "" }] },
      global: { plugins: [router] },
    });
    expect(filled.text()).toContain("A");
  });
});
