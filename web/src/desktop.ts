export type Flavor = "remote" | "full";

export type DesktopReady = {
  flavor: Flavor;
  apiBase: string | null;
  folder: string | null;
  username: string | null;
  needsSetup: boolean;
};

export type MnoteDesktop = {
  flavor: Flavor;
  ready(): Promise<Omit<DesktopReady, "needsSetup">>;
  setServer(host: string): Promise<{ ok: boolean; error?: string; apiBase?: string }>;
  pickFolder(): Promise<string | null>;
  setup(opts: {
    folder?: string;
    password: string;
    username?: string;
  }): Promise<{ token: string; username: string; apiBase: string }>;
  getToken(): Promise<string | null>;
  setToken(token: string | null): Promise<void>;
};

declare global {
  interface Window {
    mnote?: MnoteDesktop;
  }
}

let info: DesktopReady | null = null;

export function isDesktop(): boolean {
  return typeof window !== "undefined" && !!window.mnote;
}

export function flavor(): Flavor | null {
  return window.mnote?.flavor ?? null;
}

export function desktopInfo(): DesktopReady | null {
  return info;
}

export async function initDesktop(): Promise<void> {
  const { setApiBase, setSessionToken, api } = await import("./api");
  if (!window.mnote) return;
  const ready = await window.mnote.ready();
  setApiBase(ready.apiBase);
  setSessionToken(await window.mnote.getToken());
  let needsSetup = !ready.apiBase;
  if (ready.apiBase && ready.flavor === "full") {
    try {
      const status = await api.setupStatus();
      needsSetup = status.needed;
    } catch {
      needsSetup = true;
    }
  }
  info = { ...ready, needsSetup };
}

export function markSetupDone(apiBase: string, folder: string | null): void {
  if (!info) return;
  info = { ...info, apiBase, folder, needsSetup: false };
}
