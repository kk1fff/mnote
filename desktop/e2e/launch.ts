import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { desktopRoot } from "./env";

const require = createRequire(import.meta.url);

export async function launchApp(opts: {
  flavor: "remote" | "full";
  userData?: string;
  server?: string;
  data?: string;
}): Promise<{ app: ElectronApplication; page: Page; userData: string }> {
  const userData = opts.userData ?? fs.mkdtempSync(path.join(os.tmpdir(), "mnote-electron-"));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    MNOTE_FLAVOR: opts.flavor,
    MNOTE_E2E_USERDATA: userData,
  };
  if (opts.server) env.MNOTE_E2E_SERVER = opts.server;
  if (opts.data) env.MNOTE_E2E_DATA = opts.data;
  const app = await electron.launch({
    executablePath: require("electron") as string,
    args: [desktopRoot(), "--disable-gpu"],
    cwd: desktopRoot(),
    env,
  });
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  return { app, page, userData };
}
