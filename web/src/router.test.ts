import { beforeEach, describe, expect, it, vi } from "vitest";

const refreshSession = vi.fn();
const currentUser = { value: null as null | { username: string; must_change_password: boolean } };
const sessionReady = { value: false };

vi.mock("./session", () => ({
  refreshSession: () => refreshSession(),
  currentUser,
  sessionReady,
}));

describe("router guards", () => {
  beforeEach(() => {
    currentUser.value = null;
    sessionReady.value = false;
    refreshSession.mockResolvedValue(null);
    vi.resetModules();
  });

  it("sends anonymous users to login", async () => {
    const router = (await import("./router")).default;
    await router.push("/n/2026-08-22");
    await router.isReady();
    expect(router.currentRoute.value.path).toBe("/login");
  });

  it("sends logged-in users away from login", async () => {
    sessionReady.value = true;
    currentUser.value = { username: "alice", must_change_password: false };
    const router = (await import("./router")).default;
    await router.push("/login");
    await router.isReady();
    expect(router.currentRoute.value.path).not.toBe("/login");
  });

  it("forces a password change", async () => {
    sessionReady.value = true;
    currentUser.value = { username: "alice", must_change_password: true };
    const router = (await import("./router")).default;
    await router.push("/n/2026-08-22");
    await router.isReady();
    expect(router.currentRoute.value.path).toBe("/password");
  });
});
