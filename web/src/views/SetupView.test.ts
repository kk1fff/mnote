import { flushPromises, mount } from "@vue/test-utils";
import { createRouter, createWebHistory } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SetupView from "./SetupView.vue";
import { getApiBase, getSessionToken, setApiBase, setSessionToken } from "../api";
import { currentUser } from "../session";

const pickFolder = vi.fn();
const setup = vi.fn();

vi.mock("../desktop", () => ({
  desktopInfo: () => ({ flavor: "full", apiBase: null, folder: null, username: null, needsSetup: true }),
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
      revealFolder: vi.fn(),
      getToken: vi.fn(),
      setToken: vi.fn(),
    };
  });

  it("opens a folder and routes home", async () => {
    pickFolder.mockResolvedValue("/tmp/notes");
    setup.mockResolvedValue({
      token: "tok",
      username: "me",
      apiBase: "http://127.0.0.1:18732",
    });
    const { wrapper, router } = await make();
    await wrapper.get("button.ghost").trigger("click");
    await flushPromises();
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(setup).toHaveBeenCalledWith({ folder: "/tmp/notes" });
    expect(getApiBase()).toBe("http://127.0.0.1:18732");
    expect(getSessionToken()).toBe("tok");
    expect(router.currentRoute.value.path).toBe("/");
  });

  it("requires a folder", async () => {
    const { wrapper } = await make();
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(wrapper.text()).toContain("Choose a folder for your notes.");
    expect(setup).not.toHaveBeenCalled();
  });
});
