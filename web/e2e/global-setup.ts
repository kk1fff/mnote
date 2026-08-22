import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { request } from "@playwright/test";
import {
  ALICE_PASSWORD,
  ALICE_STATE,
  AUTH_DIR,
  BOB_PASSWORD,
  BOB_STATE,
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

async function setPassword(username: string, next: string, statePath: string) {
  const ctx = await request.newContext({ baseURL: E2E_URL });
  const login = await ctx.post("/api/auth/login", {
    data: { username, password: TEMP_PASSWORD },
  });
  if (!login.ok()) {
    throw new Error(`login ${username} failed: ${login.status()} ${await login.text()}`);
  }
  const change = await ctx.post("/api/auth/password", { data: { password: next } });
  if (!change.ok()) {
    throw new Error(`password ${username} failed: ${change.status()} ${await change.text()}`);
  }
  await ctx.storageState({ path: statePath });
  await ctx.dispose();
}

export default async function globalSetup() {
  const root = repoRoot();
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  execFileSync("cargo", ["build", "-q"], { cwd: root, stdio: "inherit" });
  execFileSync("npm", ["run", "build"], { cwd: path.join(root, "web"), stdio: "inherit" });

  const data = fs.mkdtempSync(path.join(root, "target", "e2e-"));
  const bin = path.join(root, "target", "debug", "mnote");
  for (const user of ["alice", "bob", "dave"]) {
    execFileSync(bin, ["--data", data, "user", "add", user, "--password", TEMP_PASSWORD], {
      stdio: "inherit",
    });
  }

  const child = spawn(
    bin,
    ["--data", data, "serve", "--bind", `127.0.0.1:${E2E_PORT}`],
    {
      cwd: root,
      env: { ...process.env, MNOTE_WEB_DIST: path.join(root, "web", "dist") },
      detached: true,
      stdio: "ignore",
    },
  );
  if (!child.pid) throw new Error("failed to start mnote");
  child.unref();
  fs.writeFileSync(
    ENV_FILE,
    JSON.stringify({ url: E2E_URL, data, bin, pid: child.pid }, null, 2),
  );

  try {
    await waitHealth(E2E_URL);
    await setPassword("alice", ALICE_PASSWORD, ALICE_STATE);
    await setPassword("bob", BOB_PASSWORD, BOB_STATE);
  } catch (err) {
    try {
      process.kill(child.pid, "SIGTERM");
    } catch {
      /* already dead */
    }
    throw err;
  }
}
