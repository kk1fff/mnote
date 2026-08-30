import { flushPromises, mount } from "@vue/test-utils";
import { createRouter, createWebHistory } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ConnectView from "./ConnectView.vue";
import { getApiBase, setApiBase } from "../api";

const setServer = vi.fn();

async function make() {
  const router = createRouter({
    history: createWebHistory(),
    routes: [
      { path: "/connect", component: ConnectView },
      { path: "/login", component: { template: "<div>login</div>" } },
    ],
  });
  await router.push("/connect");
  await router.isReady();
  return {
    router,
    wrapper: mount(ConnectView, { global: { plugins: [router] } }),
  };
}

describe("ConnectView", () => {
  beforeEach(() => {
    setApiBase(null);
    setServer.mockReset();
    window.mnote = {
      flavor: "remote",
      ready: vi.fn(),
      setServer,
      pickFolder: vi.fn(),
      setup: vi.fn(),
      getToken: vi.fn(),
      setToken: vi.fn(),
    };
  });

  it("connects and routes to login", async () => {
    setServer.mockResolvedValue({ ok: true, apiBase: "http://127.0.0.1:3000" });
    const { wrapper, router } = await make();
    await wrapper.get('input[name="server"]').setValue("127.0.0.1:3000");
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(setServer).toHaveBeenCalledWith("127.0.0.1:3000");
    expect(getApiBase()).toBe("http://127.0.0.1:3000");
    expect(router.currentRoute.value.path).toBe("/login");
  });

  it("shows an error when the server is unreachable", async () => {
    setServer.mockResolvedValue({ ok: false, error: "Can't reach the server." });
    const { wrapper } = await make();
    await wrapper.get('input[name="server"]').setValue("10.0.0.9:3000");
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(wrapper.text()).toContain("Can't reach the server.");
  });
});
