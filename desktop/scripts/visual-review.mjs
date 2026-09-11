import { _electron as electron } from "@playwright/test";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditIcons } from "../../web/scripts/icon-review.mjs";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(here, "..");
const out = path.join(desktopRoot, "artifacts", "visual");

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

async function launch(flavor, extraEnv = {}) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "mnote-visual-"));
  const app = await electron.launch({
    executablePath: require("electron"),
    args: [desktopRoot, "--disable-gpu", "--no-sandbox"],
    cwd: desktopRoot,
    env: { ...process.env, MNOTE_FLAVOR: flavor, MNOTE_E2E_USERDATA: userData, ...extraEnv },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  return { app, page, userData };
}

async function setTheme(page, theme) {
  await page.evaluate((mode) => {
    localStorage.setItem("mnote-theme", mode);
    document.documentElement.dataset.theme = mode;
    document.documentElement.dataset.themeMode = mode;
    document.documentElement.style.colorScheme = mode;
  }, theme);
}

async function shot(page, name) {
  await page.waitForLoadState("networkidle");
  await auditIcons(page);
  const file = path.join(out, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false, animations: "disabled" });
  console.log(file);
}

async function setViewport(page, width, height) {
  await page.setViewportSize({ width, height });
}

const temps = [];

try {
  const remote = await launch("remote");
  temps.push(remote.userData);
  await setTheme(remote.page, "light");
  await remote.page.getByText("Connect to your server").waitFor();
  await shot(remote.page, "01-connect-light");
  await setTheme(remote.page, "dark");
  await shot(remote.page, "01-connect-dark");
  await setTheme(remote.page, "light");
  await remote.page.locator('input[name="server"]').fill("127.0.0.1:1");
  await remote.page.getByRole("button", { name: "Connect" }).click();
  await remote.page.getByText("Can't reach the server.").waitFor();
  await shot(remote.page, "01b-connect-error-light");
  await setTheme(remote.page, "dark");
  await shot(remote.page, "01b-connect-error-dark");
  await remote.app.close();

  const data = fs.mkdtempSync(path.join(os.tmpdir(), "mnote-visual-vault-"));
  temps.push(data);
  const full = await launch("full", { MNOTE_E2E_DATA: data });
  temps.push(full.userData);
  await setTheme(full.page, "light");
  await full.page.getByText("Notes live in a folder").waitFor();
  await shot(full.page, "02-setup-light");
  await setTheme(full.page, "dark");
  await shot(full.page, "02-setup-dark");
  await setTheme(full.page, "light");
  await full.page.getByRole("button", { name: "Choose" }).click();
  await full.page.getByRole("button", { name: "Open" }).click();
  await full.page.getByTestId("note-title").waitFor({ timeout: 30_000 });
  await shot(full.page, "03-note-light");
  await full.page.getByTestId("folder-menu").click();
  await full.page.getByTestId("change-folder").waitFor();
  await shot(full.page, "04-folder-popover-light");
  await full.page.keyboard.press("Escape");
  await setTheme(full.page, "dark");
  await shot(full.page, "03-note-dark");
  await full.page.getByTestId("folder-menu").click();
  await full.page.getByTestId("change-folder").waitFor();
  await shot(full.page, "04-folder-popover-dark");
  await full.page.keyboard.press("Escape");
  await setTheme(full.page, "light");
  await setViewport(full.page, 390, 844);
  await full.page.waitForTimeout(200);
  await shot(full.page, "05-note-mobile-light");
  await setTheme(full.page, "dark");
  await shot(full.page, "05-note-mobile-dark");
  await full.app.close();
} finally {
  for (const dir of temps) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
