import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import { currentUser, login, logout, refreshSession, sessionReady } from "./session";

vi.mock("./api", () => ({
  api: {
    me: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    status: number;
    code: string;
    constructor(status: number, code: string) {
      super(code);
      this.status = status;
      this.code = code;
    }
  },
}));

describe("session", () => {
  beforeEach(() => {
    currentUser.value = null;
    sessionReady.value = false;
    vi.clearAllMocks();
  });

  it("loads the current user", async () => {
    vi.mocked(api.me).mockResolvedValue({ username: "alice", must_change_password: false });
    await expect(refreshSession()).resolves.toMatchObject({ username: "alice" });
    expect(sessionReady.value).toBe(true);
  });

  it("treats 401 as logged out", async () => {
    const { ApiError } = await import("./api");
    vi.mocked(api.me).mockRejectedValue(new ApiError(401, "unauthorized"));
    await expect(refreshSession()).resolves.toBeNull();
    expect(currentUser.value).toBeNull();
  });

  it("logs in and out", async () => {
    vi.mocked(api.login).mockResolvedValue({ username: "alice", must_change_password: false });
    vi.mocked(api.logout).mockResolvedValue(undefined);
    await login("alice", "password1");
    expect(currentUser.value?.username).toBe("alice");
    await logout();
    expect(currentUser.value).toBeNull();
  });
});
