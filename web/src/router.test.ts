import { beforeEach, describe, expect, it, vi } from "vitest";

const refreshSession = vi.fn();
const currentUser = { value: null as null | { username: string; must_change_password: boolean } };

vi.mock("./session", () => ({
  refreshSession: () => refreshSession(),
  currentUser,
}));

describe("router guards", () => {
  beforeEach(() => {
    currentUser.value = null;
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
    currentUser.value = { username: "alice", must_change_password: false };
    const router = (await import("./router")).default;
    await router.push("/login");
    await router.isReady();
    expect(router.currentRoute.value.path).not.toBe("/login");
  });

  it("forces a password change", async () => {
    currentUser.value = { username: "alice", must_change_password: true };
    const router = (await import("./router")).default;
    await router.push("/n/2026-08-22");
    await router.isReady();
    expect(router.currentRoute.value.path).toBe("/password");
  });

  it("rechecks session on every navigation", async () => {
    currentUser.value = { username: "alice", must_change_password: false };
    refreshSession.mockImplementation(async () => {
      currentUser.value = null;
      return null;
    });
    const router = (await import("./router")).default;
    await router.push("/n/2026-08-22");
    await router.isReady();
    expect(refreshSession).toHaveBeenCalled();
    expect(router.currentRoute.value.path).toBe("/login");
  });
});
