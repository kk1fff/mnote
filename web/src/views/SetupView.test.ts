import { flushPromises, mount } from "@vue/test-utils";
import { createRouter, createWebHistory } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SetupView from "./SetupView.vue";
import { getApiBase, getSessionToken, setApiBase, setSessionToken } from "../api";
import { currentUser } from "../session";

const pickFolder = vi.fn();
const setup = vi.fn();

vi.mock("../desktop", () => ({
  desktopInfo: () => ({ flavor: "full", apiBase: null, folder: null, username: "pat", needsSetup: true }),
  markSetupDone: vi.fn(),
}));

vi.mock("../live", () => ({
  live: { connect: vi.fn(), disconnect: vi.fn() },
}));

async function make() {
  const router = createRouter({
    history: createWebHistory(),
    routes: [
      { path: "/setup", component: SetupView },
      { path: "/", component: { template: "<div>home</div>" } },
    ],
  });
  await router.push("/setup");
  await router.isReady();
  return {
    router,
    wrapper: mount(SetupView, { global: { plugins: [router] } }),
  };
}

describe("SetupView", () => {
  beforeEach(() => {
    setApiBase(null);
    setSessionToken(null);
    currentUser.value = null;
    pickFolder.mockReset();
    setup.mockReset();
    window.mnote = {
      flavor: "full",
      ready: vi.fn(),
      setServer: vi.fn(),
      pickFolder,
      setup,
      getToken: vi.fn(),
      setToken: vi.fn(),
    };
  });

  it("creates a vault and routes home", async () => {
    pickFolder.mockResolvedValue("/tmp/notes");
    setup.mockResolvedValue({
      token: "tok",
      username: "pat",
      apiBase: "http://127.0.0.1:18732",
    });
    const { wrapper, router } = await make();
    await wrapper.get("button.ghost").trigger("click");
    await flushPromises();
    await wrapper.get('input[name="password"]').setValue("password1");
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(setup).toHaveBeenCalledWith({
      folder: "/tmp/notes",
      password: "password1",
      username: "pat",
    });
    expect(getApiBase()).toBe("http://127.0.0.1:18732");
    expect(getSessionToken()).toBe("tok");
    expect(router.currentRoute.value.path).toBe("/");
  });

  it("rejects a short password", async () => {
    const { wrapper } = await make();
    await wrapper.get('input[name="folder"]').setValue("/tmp/notes");
    await wrapper.get('input[name="password"]').setValue("short");
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(wrapper.text()).toContain("at least 8 characters");
    expect(setup).not.toHaveBeenCalled();
  });
});
