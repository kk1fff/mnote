import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export const AUTH_DIR = path.join(here, ".auth");
export const ENV_FILE = path.join(AUTH_DIR, "env.json");
export const TEMP_PASSWORD = "password1";
export const ALICE_PASSWORD = "alicepass1";
export const E2E_PORT = 3457;
export const E2E_URL = `http://127.0.0.1:${E2E_PORT}`;

export type E2eEnv = {
  url: string;
  data: string;
  bin: string;
  pid: number;
};

export function desktopRoot(): string {
  return path.resolve(here, "..");
}

export function repoRoot(): string {
  return path.resolve(here, "..", "..");
}

export function readEnv(): E2eEnv {
  return JSON.parse(fs.readFileSync(ENV_FILE, "utf8")) as E2eEnv;
}
