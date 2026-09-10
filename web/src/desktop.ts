export type Flavor = "remote" | "full";

export type DesktopReady = {
  flavor: Flavor;
  apiBase: string | null;
  folder: string | null;
  username: string | null;
  token?: string | null;
  error?: string | null;
  needsSetup: boolean;
};

export type MnoteDesktop = {
  flavor: Flavor;
  ready(): Promise<Omit<DesktopReady, "needsSetup">>;
  setServer(host: string): Promise<{ ok: boolean; error?: string; apiBase?: string }>;
  pickFolder(): Promise<string | null>;
  setup(opts?: { folder?: string }): Promise<{ token: string; username: string; apiBase: string }>;
  revealFolder(): Promise<boolean>;
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
  const { setApiBase, setSessionToken } = await import("./api");
  if (!window.mnote) return;
  const ready = await window.mnote.ready();
  setApiBase(ready.apiBase);
  const token = ready.token ?? (await window.mnote.getToken());
  setSessionToken(token ?? null);
  const needsSetup = ready.flavor === "full" ? !ready.apiBase || !ready.folder : !ready.apiBase;
  info = { ...ready, needsSetup };
}

export function markSetupDone(apiBase: string, folder: string | null): void {
  if (!info) {
    info = {
      flavor: window.mnote?.flavor ?? "full",
      apiBase,
      folder,
      username: null,
      needsSetup: false,
    };
    return;
  }
  info = { ...info, apiBase, folder, needsSetup: false, error: null };
}
