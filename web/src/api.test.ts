import { afterEach, describe, expect, it, vi } from "vitest";
import {
  api,
  ApiError,
  liveUrl,
  rewriteApiUrls,
  setApiBase,
  setSessionToken,
  setUnauthorizedHandler,
} from "./api";

afterEach(() => {
  setUnauthorizedHandler(null);
  setApiBase(null);
  setSessionToken(null);
  vi.unstubAllGlobals();
});

function jsonResponse(status: number, body: unknown) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
  });
}

describe("api", () => {
  it("parses success and empty responses", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(api.health()).resolves.toEqual({ ok: true });
    await expect(api.logout()).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/health",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("notifies on 401 except login and me", async () => {
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => jsonResponse(401, { error: "unauthorized" })),
    );
    await api.listNotes().catch(() => undefined);
    await api.login("a", "b").catch(() => undefined);
    await api.me().catch(() => undefined);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("throws ApiError from json error bodies", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => jsonResponse(401, { error: "unauthorized" })),
    );
    const err = await api.me().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 401, code: "unauthorized" });
  });

  it("throws ApiError on non-json error bodies", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("<html>502</html>", { status: 502 })),
    );
    const err = await api.me().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 502, code: "request_failed" });
  });

  it("leaves multipart content type to fetch", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        id: "asset",
        url: "/api/assets/asset",
        markdown: "![](mnote-asset:asset)",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await api.uploadAsset(new File(["image"], "image.png", { type: "image/png" }), "Trips/2026");
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.body).toBeInstanceOf(FormData);
    expect(new Headers(init.headers).has("Content-Type")).toBe(false);
  });

  it("covers remaining endpoints", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).startsWith("/api/search")) return jsonResponse(200, []);
      if (String(url).startsWith("/api/assets")) return jsonResponse(200, { id: "1.png", url: "/api/assets/1.png", markdown: "![](/api/assets/1.png)" });
      if (init?.method === "POST" && url === "/api/notes") {
        return jsonResponse(201, { id: "x", title: "x", content: "", modified_at: "" });
      }
      return jsonResponse(200, { id: "x", title: "x", content: "c", modified_at: "" });
    });
    vi.stubGlobal("fetch", fetchMock);
    await api.login("a", "b");
    await api.changePassword("password1");
    await api.listNotes();
    await api.titleSearch("idea");
    await api.recentNotes();
    await api.favorites();
    await api.favorite("note-1");
    await api.unfavorite("note-1");
    await api.collapsedFolders();
    await api.collapseFolder("work/projects");
    await api.expandFolder("work/projects");
    await api.getNote("note-1");
    await api.putNote("note-1", "hi");
    await api.patchNote("note-1", { title: "Renamed", folder: "ideas" });
    await api.deleteNote("note-1");
    await api.createNote("Two", "ideas", "x");
    await api.daily("2026-08-22");
    await api.putDaily("2026-08-22", "d");
    await api.search("q");
    await api.backlinks("note-1");
    await api.noteHistory("note-1");
    await api.noteRevision("note-1", "2026-08-22T14-30-00Z");
    await api.restoreNote("note-1", "2026-08-22T14-30-00Z");
    await api.listParked();
    await api.createParked({ body: "ask jim" });
    await api.parkedToNote(1);
    await api.deleteParked(1);
    await api.uploadAsset(new File(["x"], "a.png", { type: "image/png" }));
    expect(fetchMock).toHaveBeenCalled();
  });

  it("prefixes the API base and sends a bearer token", async () => {
    setApiBase("http://192.168.1.10:3000");
    setSessionToken("tok");
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    await api.health();
    expect(fetchMock).toHaveBeenCalledWith(
      "http://192.168.1.10:3000/api/health",
      expect.objectContaining({
        headers: expect.any(Headers),
      }),
    );
    const headers = fetchMock.mock.calls[0][1].headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer tok");
  });

  it("rewrites asset urls and live socket urls", () => {
    setApiBase("http://10.0.0.2:3000");
    setSessionToken("abc");
    expect(rewriteApiUrls("![](/api/assets/1.png)")).toBe("![](http://10.0.0.2:3000/api/assets/1.png)");
    expect(liveUrl()).toBe("ws://10.0.0.2:3000/api/live?token=abc");
  });
});
