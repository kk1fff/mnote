import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  ALICE_PASSWORD,
  AUTH_DIR,
  E2E_PORT,
  E2E_URL,
  ENV_FILE,
  TEMP_PASSWORD,
  repoRoot,
} from "./env";

async function waitHealth(url: string) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`mnote did not become healthy at ${url}`);
}

export default async function globalSetup() {
  const root = repoRoot();
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  execFileSync("cargo", ["build", "-q"], { cwd: root, stdio: "inherit" });
  execFileSync("npm", ["run", "build"], { cwd: path.join(root, "web"), stdio: "inherit" });
  execFileSync("npm", ["run", "build"], { cwd: path.join(root, "desktop"), stdio: "inherit" });

  const data = fs.mkdtempSync(path.join(root, "target", "desktop-e2e-"));
  const bin = path.join(root, "target", "debug", "mnote");
  execFileSync(bin, ["--data", data, "user", "add", "alice", "--password", TEMP_PASSWORD], {
    stdio: "inherit",
  });

  const child = spawn(bin, ["--data", data, "serve", "--bind", `127.0.0.1:${E2E_PORT}`], {
    cwd: root,
    env: { ...process.env, MNOTE_WEB_DIST: path.join(root, "web", "dist") },
    detached: true,
    stdio: "ignore",
  });
  if (!child.pid) throw new Error("failed to start mnote");
  child.unref();
  fs.writeFileSync(ENV_FILE, JSON.stringify({ url: E2E_URL, data, bin, pid: child.pid }, null, 2));

  try {
    await waitHealth(E2E_URL);
    const login = await fetch(`${E2E_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "alice", password: TEMP_PASSWORD }),
    });
    if (!login.ok) throw new Error(`login failed: ${login.status}`);
    const session = (await login.json()) as { token?: string };
    const change = await fetch(`${E2E_URL}/api/auth/password`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.token}`,
      },
      body: JSON.stringify({ password: ALICE_PASSWORD }),
    });
    if (!change.ok) throw new Error(`password failed: ${change.status}`);
  } catch (err) {
    try {
      process.kill(child.pid, "SIGTERM");
    } catch {
      /* already dead */
    }
    throw err;
  }
}
