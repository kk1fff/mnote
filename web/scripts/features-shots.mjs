import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, "..", "..", "features", "assets");
const url = process.env.MNOTE_FEATURES_URL ?? "http://127.0.0.1:3010";
const user = process.env.MNOTE_FEATURES_USER ?? "visual";
const pass = process.env.MNOTE_FEATURES_PASS ?? "visualpass1";
const temp = process.env.MNOTE_FEATURES_TEMP ?? "password1";

const TODAY = `Saturday market

Need [[Weekly groceries]] before noon.

- [ ] Farmers market
- [x] Return library books
- [ ] Text Sam about dinner
`;

const GROCERIES = `- #shopping
  - oat milk #grocery
  - eggs #grocery
  - apples #grocery
- #hardware
  - spare bulbs

| Item | Qty | Notes |
| --- | ---: | --- |
| Oat milk | 2 | fridge |
| Eggs | 12 | |
| Apples | 6 | Honeycrisp |
`;

fs.mkdirSync(out, { recursive: true });

function editor(page) {
  return page.locator("[data-testid='pane-primary'] .cm-content, [data-testid='editor'] .cm-content").first();
}

async function shot(page, name) {
  const file = path.join(out, `${name}.png`);
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: file, fullPage: false, animations: "disabled" });
  console.log(file);
}

async function ready(page, pathName = "/login") {
  const res = await page.goto(`${url}${pathName}`, { waitUntil: "networkidle" });
  if (!res || res.status() >= 500) {
    throw new Error(`features shots need the app at ${url} (got ${res?.status() ?? "no response"})`);
  }
}

async function login(page, password = pass) {
  await ready(page, "/login");
  if (await page.locator('input[name="username"]').count()) {
    await page.locator('input[name="username"]').fill(user);
    await page.locator('input[name="password"]').fill(password);
    await page.getByRole("button", { name: "Log in" }).click();
    const next = page.locator('input[name="new-password"]');
    try {
      await next.waitFor({ timeout: 2000 });
      await next.fill(pass);
      await page.locator('input[name="confirm-password"]').fill(pass);
      await page.getByRole("button", { name: "Save" }).click();
    } catch {
      if (await page.locator('input[name="username"]').count()) {
        await page.locator('input[name="username"]').fill(user);
        await page.locator('input[name="password"]').fill(pass);
        await page.getByRole("button", { name: "Log in" }).click();
      }
    }
  }
  try {
    await page.waitForURL(/\/n\//, { timeout: 8000 });
  } catch {
    if (password !== temp) return login(page, temp);
    throw new Error(`could not sign in as ${user}`);
  }
}

async function noteAction(page, testId) {
  const pane = page.getByTestId("pane-primary");
  const root = (await pane.count()) ? pane : page;
  const item = root.getByTestId(testId);
  if (!(await item.isVisible())) {
    await root.getByRole("button", { name: "More actions" }).click();
  }
  await item.click();
}

async function saveNote(page) {
  await noteAction(page, "save");
  await page.getByTestId("note-saved-toast").waitFor({ timeout: 8000 }).catch(() => undefined);
}

async function openPicker(page) {
  const navOpen = await page.locator(".app-shell").evaluate((el) => el.classList.contains("nav-open"));
  const menu = page.getByRole("button", { name: "Menu", exact: true });
  if (!navOpen && (await menu.isVisible())) await menu.click();
  await page.getByTestId("sidebar").getByRole("button", { name: "Search notes" }).click();
  await page.waitForSelector('[data-testid="picker"]');
}

async function closePicker(page) {
  for (let i = 0; i < 3; i++) {
    if (!(await page.locator('[data-testid="picker"]').count())) return;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(80);
  }
}

async function releaseMods(page) {
  await page.keyboard.up("Control");
  await page.keyboard.up("Meta");
  await page.keyboard.up("Alt");
  await page.keyboard.up("Shift");
}

async function closeSheet(page) {
  const close = page.getByRole("button", { name: "Close" }).last();
  if (await close.count()) await close.click().catch(() => undefined);
  await page.keyboard.press("Escape").catch(() => undefined);
  await page.waitForTimeout(150);
  await page.waitForSelector('[data-testid="park-capture"]', { state: "hidden", timeout: 2000 }).catch(() => undefined);
}

async function setBody(page, text) {
  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+a");
  await releaseMods(page);
  await page.keyboard.insertText(text);
  await page.waitForTimeout(200);
}

async function openOrCreate(page, title) {
  await openPicker(page);
  await page.getByTestId("picker-input").fill(title);
  const existing = page.getByTestId("picker").getByRole("button", { name: title, exact: true });
  await page.waitForTimeout(300);
  if (await existing.count()) await existing.click();
  else await page.getByTestId("picker-create").click();
  await page.waitForSelector('[data-testid="editor"]');
  await page.getByTestId("note-title").filter({ hasText: title }).waitFor({ timeout: 8000 }).catch(() => undefined);
  await page.waitForLoadState("networkidle");
}

const browser = await chromium.launch({ headless: true });
const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await desktop.newPage();
await page.addInitScript(() => {
  localStorage.setItem("mnote-theme", "light");
});

await ready(page, "/setup");
await page.getByText("Notes live in a folder").waitFor();
await shot(page, "setup");

await login(page);
await page.waitForSelector('[data-testid="editor"]');
await setBody(page, TODAY);
await saveNote(page);
await shot(page, "note");

await openOrCreate(page, "Weekly groceries");
await setBody(page, GROCERIES);
await saveNote(page);
await page.waitForSelector('[data-testid="table-mat"]', { timeout: 8000 });

await openPicker(page);
await page.getByTestId("picker-input").fill("#shopping > #grocery");
await page.getByTestId("picker-tag-hit").filter({ hasText: "grocery" }).first().waitFor({ timeout: 8000 });
await shot(page, "tags");
await closePicker(page);

await page.getByTestId("table-edit").first().click();
await page.getByTestId("table-editor").waitFor();
await shot(page, "table");
await page.getByRole("button", { name: "Cancel", exact: true }).click().catch(() => undefined);
await closeSheet(page);

await page.goto(`${url}/today`, { waitUntil: "networkidle" });
await page.waitForSelector('[data-testid="editor"]');
const cm = page.getByTestId("pane-primary").locator(".cm-editor");
await cm.evaluate((el) => el.classList.add("cm-mod-task"));
await shot(page, "todo");
await cm.evaluate((el) => el.classList.remove("cm-mod-task"));

await closeSheet(page);
await editor(page).click();
await releaseMods(page);
await page.keyboard.press("Escape").catch(() => undefined);
await page.waitForSelector('[data-testid="park-capture"]', { state: "hidden", timeout: 2000 }).catch(() => undefined);
await page.keyboard.press("ControlOrMeta+End");
await releaseMods(page);
await page.keyboard.insertText("\n");
await page.keyboard.type("@");
await page.waitForSelector('[data-testid="date-suggest"]');
await page.waitForSelector('[data-testid="park-capture"]', { state: "hidden" });
await shot(page, "date");
await page.keyboard.press("Escape");
await page.waitForSelector('[data-testid="date-suggest"]', { state: "hidden", timeout: 3000 }).catch(() => undefined);

await noteAction(page, "park");
await page.waitForSelector('[data-testid="park-capture"]');
await page.getByTestId("park-body").fill("Oat milk if they have the 1L carton #shopping");
await page.waitForTimeout(200);
await shot(page, "park");
await closeSheet(page);

await editor(page).click();
await page.keyboard.press("End");
await page.keyboard.type("\nBring a tote bag.\n");
await saveNote(page);
await noteAction(page, "history");
await page.waitForSelector('[data-testid="history-panel"]');
await shot(page, "history");
await closeSheet(page);

await openPicker(page);
await page.waitForTimeout(250);
await shot(page, "picker");
await closePicker(page);

const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
const m = await mobile.newPage();
await m.addInitScript(() => {
  localStorage.setItem("mnote-theme", "light");
});
await login(m);
await m.waitForSelector('[data-testid="editor"]');
await m.locator(".cm-content").filter({ hasText: "Farmers market" }).waitFor({ timeout: 8000 });
await shot(m, "mobile");

await browser.close();
console.log(`features shots wrote ${out}`);
