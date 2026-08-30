import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  net,
  protocol,
  safeStorage,
  session,
} from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createServer } from "node:net";

const here = path.dirname(fileURLToPath(import.meta.url));

function detectFlavor(): "remote" | "full" {
  if (process.env.MNOTE_FLAVOR === "remote" || process.env.MNOTE_FLAVOR === "full") {
    return process.env.MNOTE_FLAVOR;
  }
  try {
    const marker = path.join(process.resourcesPath, "flavor");
    if (fs.existsSync(marker) && fs.readFileSync(marker, "utf8").trim() === "remote") {
      return "remote";
    }
  } catch {
    /* unpackaged */
  }
  return "full";
}

const flavor = detectFlavor();

protocol.registerSchemesAsPrivileged([
  {
    scheme: "mnote",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

if (process.env.MNOTE_E2E_USERDATA) {
  app.setPath("userData", process.env.MNOTE_E2E_USERDATA);
}

type Store = {
  server?: string;
  folder?: string;
  token?: string;
};

let win: BrowserWindow | null = null;
let child: ChildProcess | null = null;
let sidecarBase: string | null = null;
let authFilter: string | null = null;

function repoRoot(): string {
  return path.resolve(here, "..", "..");
}

function webDist(): string {
  if (app.isPackaged) return path.join(process.resourcesPath, "web-dist");
  return path.join(repoRoot(), "web", "dist");
}

function sidecarBin(): string {
  const name = process.platform === "win32" ? "mnote.exe" : "mnote";
  if (app.isPackaged) return path.join(process.resourcesPath, name);
  const release = path.join(repoRoot(), "target", "release", name);
  const debug = path.join(repoRoot(), "target", "debug", name);
  return fs.existsSync(release) ? release : debug;
}

function storePath(): string {
  return path.join(app.getPath("userData"), "desktop.json");
}

function loadStore(): Store {
  try {
    return JSON.parse(fs.readFileSync(storePath(), "utf8")) as Store;
  } catch {
    return {};
  }
}

function saveStore(next: Store) {
  fs.mkdirSync(path.dirname(storePath()), { recursive: true });
  fs.writeFileSync(storePath(), JSON.stringify(next, null, 2));
}

function encrypt(plain: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(plain).toString("base64");
  }
  return `plain:${plain}`;
}

function decrypt(stored?: string): string | null {
  if (!stored) return null;
  if (stored.startsWith("plain:")) return stored.slice(6);
  try {
    return safeStorage.decryptString(Buffer.from(stored, "base64"));
  } catch {
    return null;
  }
}

function sanitizeUser(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
  return cleaned || "me";
}

function normalizeServer(input: string): string {
  let value = input.trim();
  if (!/^https?:\/\//i.test(value)) value = `http://${value}`;
  const url = new URL(value);
  if (!url.port) url.port = "3000";
  return `${url.protocol}//${url.hostname}:${url.port}`;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        server.close();
        reject(new Error("no port"));
        return;
      }
      const port = addr.port;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

function waitHealth(apiBase: string, ms = 20_000): Promise<void> {
  const deadline = Date.now() + ms;
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(`${apiBase}/api/health`, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) {
          resolve();
          return;
        }
        retry();
      });
      req.on("error", retry);
      req.setTimeout(1000, () => {
        req.destroy();
        retry();
      });
    };
    const retry = () => {
      if (Date.now() > deadline) {
        reject(new Error("mnote did not become healthy"));
        return;
      }
      setTimeout(tick, 150);
    };
    tick();
  });
}

function attachAuth(apiBase: string) {
  authFilter = `${apiBase}/*`;
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: [authFilter] }, (details, cb) => {
    const token = decrypt(loadStore().token);
    if (token) details.requestHeaders.Authorization = `Bearer ${token}`;
    cb({ requestHeaders: details.requestHeaders });
  });
}

async function stopSidecar() {
  if (!child?.pid) {
    child = null;
    sidecarBase = null;
    return;
  }
  const pid = child.pid;
  child.kill("SIGTERM");
  child = null;
  sidecarBase = null;
  await new Promise((r) => setTimeout(r, 200));
  try {
    process.kill(pid, 0);
    process.kill(pid, "SIGKILL");
  } catch {
    /* already gone */
  }
}

async function startSidecar(dataDir: string): Promise<string> {
  await stopSidecar();
  fs.mkdirSync(dataDir, { recursive: true });
  const port = await freePort();
  const bin = sidecarBin();
  if (!fs.existsSync(bin)) throw new Error(`missing mnote binary at ${bin}`);
  child = spawn(bin, ["--data", dataDir, "serve", "--bind", `127.0.0.1:${port}`], {
    stdio: "ignore",
    env: { ...process.env, MNOTE_DATA: dataDir },
  });
  sidecarBase = `http://127.0.0.1:${port}`;
  await waitHealth(sidecarBase);
  attachAuth(sidecarBase);
  return sidecarBase;
}

function registerProtocol() {
  protocol.handle("mnote", (req) => {
    const url = new URL(req.url);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === "/" || pathname === "") pathname = "/index.html";
    const dist = webDist();
    const target = path.normalize(path.join(dist, pathname));
    const rel = path.relative(dist, target);
    const safe = rel && !rel.startsWith("..") && !path.isAbsolute(rel);
    const file =
      safe && fs.existsSync(target) && fs.statSync(target).isFile()
        ? target
        : path.join(dist, "index.html");
    return net.fetch(pathToFileURL(file).href);
  });
}

function preloadScript(): string {
  const src = path.join(here, "preload.cjs");
  const dest = path.join(app.getPath("userData"), "mnote-preload.cjs");
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  return dest;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    title: flavor === "remote" ? "mnote Remote" : "mnote",
    webPreferences: {
      preload: preloadScript(),
      additionalArguments: [`--mnote-flavor=${flavor}`],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.webContents.on("preload-error", (_e, preloadPath, err) => {
    console.error("preload-error", preloadPath, err);
  });
  void win.loadURL("mnote://app/");
}

app.whenReady().then(() => {
  registerProtocol();
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: app.name,
        submenu: [
          { role: "about" },
          { type: "separator" },
          { role: "quit" },
        ],
      },
      { role: "editMenu" },
      { role: "windowMenu" },
    ]),
  );
  ipcMain.handle("mnote:ready", async () => {
    const store = loadStore();
    if (flavor === "full") {
      const folder = process.env.MNOTE_E2E_DATA || store.folder || null;
      let apiBase: string | null = null;
      if (folder) apiBase = await startSidecar(folder);
      return {
        flavor,
        apiBase,
        folder,
        username: sanitizeUser(os.userInfo().username),
      };
    }
    const server = process.env.MNOTE_E2E_SERVER || store.server || null;
    const apiBase = server ? normalizeServer(server) : null;
    if (apiBase) attachAuth(apiBase);
    return { flavor, apiBase, folder: null, username: null };
  });
  ipcMain.handle("mnote:setServer", async (_e, host: string) => {
    try {
      const apiBase = normalizeServer(host);
      await waitHealth(apiBase, 4000);
      saveStore({ ...loadStore(), server: apiBase });
      attachAuth(apiBase);
      return { ok: true, apiBase };
    } catch {
      return { ok: false, error: "Can't reach the server." };
    }
  });
  ipcMain.handle("mnote:pickFolder", async () => {
    if (process.env.MNOTE_E2E_DATA) return process.env.MNOTE_E2E_DATA;
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled) return null;
    return result.filePaths[0] ?? null;
  });
  ipcMain.handle("mnote:setup", async (_e, opts: { folder?: string; password: string; username?: string }) => {
    const folder = opts.folder || process.env.MNOTE_E2E_DATA || loadStore().folder;
    if (!folder) throw new Error("Choose a folder for your notes.");
    const apiBase = sidecarBase || (await startSidecar(folder));
    const username = sanitizeUser(opts.username || os.userInfo().username);
    const res = await fetch(`${apiBase}/api/setup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password: opts.password }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      token?: string;
      username?: string;
    };
    if (!res.ok) throw new Error(body.error || "Couldn't create the vault.");
    saveStore({
      ...loadStore(),
      folder,
      token: body.token ? encrypt(body.token) : loadStore().token,
    });
    return { token: body.token, username: body.username || username, apiBase };
  });
  ipcMain.handle("mnote:getToken", () => decrypt(loadStore().token));
  ipcMain.handle("mnote:setToken", (_e, token: string | null) => {
    const store = loadStore();
    if (token) store.token = encrypt(token);
    else delete store.token;
    saveStore(store);
  });
  createWindow();
});

app.on("window-all-closed", () => {
  void stopSidecar().then(() => app.quit());
});

app.on("before-quit", () => {
  void stopSidecar();
});
