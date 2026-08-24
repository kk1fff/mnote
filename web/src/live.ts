import type { NoteMeta } from "./api";

export type LivePeer = { client_id: string; from: number; to: number };

export type LiveEvent =
  | { type: "opened"; path: string; rev: number; content: string }
  | { type: "change"; path: string; rev: number; content: string; from: number; to: number; insert: string; client_id: string }
  | { type: "resync"; path: string; rev: number; content: string; conflict: boolean }
  | { type: "cursor"; client_id: string; from: number; to: number }
  | { type: "peers"; peers: LivePeer[] }
  | { type: "gone"; client_id: string }
  | { type: "index"; note: NoteMeta }
  | { type: "deleted"; id: string }
  | { type: "status"; connected: boolean };

type Handler = (event: LiveEvent) => void;

function newClientId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `c-${Math.random().toString(36).slice(2)}`;
}

export class Live {
  private ws: WebSocket | null = null;
  private handlers = new Set<Handler>();
  private openPath: { path: string; content: string } | null = null;
  private ping: number | undefined;
  private retry: number | undefined;
  private closed = false;
  connected = false;
  id = newClientId();

  on(handler: Handler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  connect() {
    this.closed = false;
    if (!this.id) this.id = newClientId();
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.openSocket();
  }

  disconnect() {
    this.closed = true;
    window.clearInterval(this.ping);
    window.clearTimeout(this.retry);
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    this.setConnected(false);
  }

  open(path: string, content: string) {
    this.openPath = { path, content };
    this.send({ type: "open", path, content });
  }

  change(path: string, rev: number, content: string, from: number, to: number, insert: string) {
    this.send({ type: "change", path, rev, content, from, to, insert });
  }

  cursor(from: number, to: number) {
    this.send({ type: "cursor", from, to });
  }

  push(path: string, base: string, content: string) {
    this.send({ type: "push", path, base, content });
  }

  private openSocket() {
    if (this.closed || typeof WebSocket === "undefined") return;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/api/live`);
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.setConnected(true);
      this.send({ type: "hello", client_id: this.id });
      if (this.openPath) this.send({ type: "open", ...this.openPath });
      window.clearInterval(this.ping);
      this.ping = window.setInterval(() => this.send({ type: "ping" }), 20000);
    };
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(String(event.data)) as LiveEvent | { type: string };
        if (
          data.type === "opened" ||
          data.type === "change" ||
          data.type === "resync" ||
          data.type === "cursor" ||
          data.type === "peers" ||
          data.type === "gone" ||
          data.type === "index" ||
          data.type === "deleted"
        ) {
          this.emit(data as LiveEvent);
        }
      } catch {
        return;
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.setConnected(false);
      if (this.closed) return;
      window.clearTimeout(this.retry);
      this.retry = window.setTimeout(() => this.openSocket(), 1000);
    };
  }

  private send(body: unknown) {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(body));
  }

  private setConnected(connected: boolean) {
    if (this.connected === connected) return;
    this.connected = connected;
    this.emit({ type: "status", connected });
  }

  private emit(event: LiveEvent) {
    for (const handler of this.handlers) handler(event);
  }
}

export function createLive() {
  return new Live();
}

export const live = createLive();
