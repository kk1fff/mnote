import { afterEach, describe, expect, it, vi } from "vitest";
import { live } from "./live";

afterEach(() => {
  live.disconnect();
  vi.unstubAllGlobals();
});

describe("live", () => {
  it("sends hello and open, and forwards peer events", async () => {
    const sent: string[] = [];
    const listeners: Record<string, (ev?: { data?: string }) => void> = {};
    vi.stubGlobal(
      "WebSocket",
      class {
        static OPEN = 1;
        readyState = 1;
        send = (data: string) => sent.push(data);
        close = () => {};
        set onopen(fn: () => void) {
          listeners.open = fn;
        }
        set onmessage(fn: (ev?: { data?: string }) => void) {
          listeners.message = fn;
        }
        set onclose(fn: () => void) {
          listeners.close = fn;
        }
      },
    );
    live.id = "tab-a";
    const events: string[] = [];
    const stop = live.on((event) => events.push(event.type));
    live.connect();
    listeners.open?.();
    expect(sent.some((s) => s.includes("hello") && s.includes("tab-a"))).toBe(true);
    live.open("ideas/one", "hi");
    expect(sent.some((s) => s.includes("open") && s.includes("ideas/one"))).toBe(true);
    listeners.message?.({
      data: JSON.stringify({ type: "cursor", client_id: "b", from: 1, to: 2 }),
    });
    expect(events).toContain("cursor");
    stop();
  });

  it("sends queued open after connect and ignores sessionStorage id", () => {
    const sent: string[] = [];
    const listeners: Record<string, (ev?: { data?: string }) => void> = {};
    vi.stubGlobal(
      "WebSocket",
      class {
        static OPEN = 1;
        readyState = 1;
        send = (data: string) => sent.push(data);
        close = () => {};
        set onopen(fn: () => void) {
          listeners.open = fn;
        }
        set onmessage(fn: (ev?: { data?: string }) => void) {
          listeners.message = fn;
        }
        set onclose(fn: () => void) {
          listeners.close = fn;
        }
      },
    );
    sessionStorage.setItem("mnote:client_id", "shared");
    live.id = "";
    live.open("note-1", "hi");
    live.connect();
    listeners.open?.();
    const hello = sent.find((s) => s.includes("hello"));
    expect(hello).toBeTruthy();
    expect(hello).not.toContain("shared");
    expect(sent.some((s) => s.includes("open") && s.includes("note-1"))).toBe(true);
  });
});
