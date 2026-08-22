import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import App from "./App.vue";

describe("App", () => {
  it("renders a router view", () => {
    const wrapper = mount(App, {
      global: { stubs: { RouterView: { template: "<div>outlet</div>" } } },
    });
    expect(wrapper.text()).toContain("outlet");
  });
});
