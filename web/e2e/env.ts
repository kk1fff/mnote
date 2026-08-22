import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export const AUTH_DIR = path.join(here, ".auth");
export const ENV_FILE = path.join(AUTH_DIR, "env.json");
export const ALICE_STATE = path.join(AUTH_DIR, "alice.json");
export const BOB_STATE = path.join(AUTH_DIR, "bob.json");

export const TEMP_PASSWORD = "password1";
export const ALICE_PASSWORD = "alicepass1";
export const BOB_PASSWORD = "bobpass123";
export const E2E_PORT = 3456;
export const E2E_URL = `http://127.0.0.1:${E2E_PORT}`;

export type E2eEnv = {
  url: string;
  data: string;
  bin: string;
  pid: number;
};

export function repoRoot(): string {
  return path.resolve(here, "..", "..");
}

export function readEnv(): E2eEnv {
  return JSON.parse(fs.readFileSync(ENV_FILE, "utf8")) as E2eEnv;
}

export function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}
