import { flushPromises, mount } from "@vue/test-utils";
import { createRouter, createWebHistory } from "vue-router";
import { describe, expect, it, vi } from "vitest";
import PasswordView from "./PasswordView.vue";
import { api } from "../api";
import { currentUser } from "../session";

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return {
    ...actual,
    api: {
      ...actual.api,
      changePassword: vi.fn(),
    },
  };
});

describe("PasswordView", () => {
  it("validates and saves", async () => {
    const router = createRouter({
      history: createWebHistory(),
      routes: [
        { path: "/password", component: PasswordView },
        { path: "/", component: { template: "<div />" } },
      ],
    });
    await router.push("/password");
    await router.isReady();
    currentUser.value = { username: "alice", must_change_password: true };
    const wrapper = mount(PasswordView, { global: { plugins: [router] } });
    expect(wrapper.text()).toContain("Set your password");
    expect(wrapper.text()).toContain("temporary password");

    await wrapper.get("form").trigger("submit");
    expect(wrapper.text()).toContain("at least 8");

    const inputs = wrapper.findAll("input");
    await inputs[0].setValue("newpass12");
    await inputs[1].setValue("mismatch");
    await wrapper.get("form").trigger("submit");
    expect(wrapper.text()).toContain("do not match");

    vi.mocked(api.changePassword).mockResolvedValue({
      username: "alice",
      must_change_password: false,
    });
    await inputs[1].setValue("newpass12");
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(api.changePassword).toHaveBeenCalledWith("newpass12");
    expect(router.currentRoute.value.path).toBe("/");

    vi.mocked(api.changePassword).mockRejectedValue(new Error("nope"));
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(wrapper.text()).toContain("Could not change password");
  });
});
