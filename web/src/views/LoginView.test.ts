import { flushPromises, mount } from "@vue/test-utils";
import { createRouter, createWebHistory } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LoginView from "./LoginView.vue";
import { currentUser } from "../session";

const login = vi.fn();

vi.mock("../session", () => ({
  login: (...args: unknown[]) => login(...args),
  currentUser: { value: null },
}));

async function make() {
  const router = createRouter({
    history: createWebHistory(),
    routes: [
      { path: "/login", component: LoginView },
      { path: "/", component: { template: "<div>home</div>" } },
      { path: "/password", component: { template: "<div>pw</div>" } },
    ],
  });
  await router.push("/login");
  await router.isReady();
  return {
    router,
    wrapper: mount(LoginView, { global: { plugins: [router] } }),
  };
}

describe("LoginView", () => {
  beforeEach(() => {
    login.mockReset();
    currentUser.value = null;
  });

  it("logs in and routes home", async () => {
    login.mockResolvedValue({ username: "alice", must_change_password: false });
    const { wrapper, router } = await make();
    await wrapper.get('input[name="username"]').setValue("alice");
    await wrapper.get('input[name="password"]').setValue("password1");
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(login).toHaveBeenCalledWith("alice", "password1");
    expect(router.currentRoute.value.path).toBe("/");
  });

  it("routes to password change when required", async () => {
    login.mockResolvedValue({ username: "alice", must_change_password: true });
    const { wrapper, router } = await make();
    await wrapper.get('input[name="username"]').setValue("alice");
    await wrapper.get('input[name="password"]').setValue("password1");
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/password");
  });

  it("shows an error on failure", async () => {
    const { ApiError } = await import("../api");
    login.mockRejectedValue(new ApiError(401, "unauthorized"));
    const { wrapper } = await make();
    await wrapper.get('input[name="username"]').setValue("alice");
    await wrapper.get('input[name="password"]').setValue("bad");
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(wrapper.text()).toContain("Invalid username or password");
  });

  it("shows a server-down message when the API is unreachable", async () => {
    login.mockRejectedValue(new TypeError("Failed to fetch"));
    const { wrapper } = await make();
    await wrapper.get('input[name="username"]').setValue("alice");
    await wrapper.get('input[name="password"]').setValue("password1");
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(wrapper.text()).toContain("Can't reach the server");
  });
});
