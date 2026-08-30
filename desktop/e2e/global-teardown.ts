import fs from "node:fs";
import { ENV_FILE, readEnv } from "./env";

export default async function globalTeardown() {
  try {
    const { pid, data } = readEnv();
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      /* already dead */
    }
    fs.rmSync(data, { recursive: true, force: true });
    fs.rmSync(ENV_FILE, { force: true });
  } catch {
    /* no env */
  }
}
