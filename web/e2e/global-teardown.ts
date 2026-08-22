import { readEnv } from "./env";

export default async function globalTeardown() {
  try {
    const { pid } = readEnv();
    process.kill(pid, "SIGTERM");
  } catch {
    /* already gone */
  }
}
