import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, "..", "artifacts", "visual");
const url = process.env.MNOTE_VISUAL_URL ?? "http://127.0.0.1:5173";
const user = process.env.MNOTE_VISUAL_USER ?? "visual";
const pass = process.env.MNOTE_VISUAL_PASS ?? "visualpass1";
const temp = process.env.MNOTE_VISUAL_TEMP ?? "password1";

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

async function shot(page, name) {
  const file = path.join(out, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log(file);
}

async function ready(page, pathName = "/login") {
  const res = await page.goto(`${url}${pathName}`, { waitUntil: "networkidle" });
  if (!res || res.status() >= 500) {
    throw new Error(`visual review needs the app at ${url} (got ${res?.status() ?? "no response"})`);
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
    throw new Error(
      `could not sign in as ${user}. Create the account first:\n` +
        `  cargo run -- --data data user add ${user} --password ${temp}`,
    );
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

async function closeSheet(page) {
  const close = page.getByRole("button", { name: "Close" }).last();
  if (await close.count()) await close.click().catch(() => undefined);
  await page.keyboard.press("Escape").catch(() => undefined);
  await page.waitForTimeout(150);
}

async function openPicker(page) {
  await page.getByTestId("sidebar").getByRole("button", { name: "Go to…" }).click();
  await page.waitForSelector('[data-testid="picker"]');
}

async function closePicker(page) {
  for (let i = 0; i < 3; i++) {
    if (!(await page.locator('[data-testid="picker"]').count())) return;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(80);
  }
}

async function pickerChrome(page) {
  return page.locator(".note-picker").evaluate((el) => {
    const box = el.getBoundingClientRect();
    const field = el.querySelector(".picker-field")?.getBoundingClientRect();
    return { x: box.x, y: box.y, w: box.width, fieldH: field?.height ?? 0 };
  });
}

function sameChrome(before, after, label) {
  if (
    Math.abs(before.x - after.x) > 1 ||
    Math.abs(before.y - after.y) > 1 ||
    Math.abs(before.w - after.w) > 1 ||
    Math.abs(before.fieldH - after.fieldH) > 1
  ) {
    console.warn(
      `picker chrome moved on ${label}: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`,
    );
  }
}

const browser = await chromium.launch({ headless: true });

const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await desktop.newPage();
await page.addInitScript(() => localStorage.setItem("mnote-theme", "light"));
await ready(page, "/login");
await shot(page, "01-login-light");
await login(page);
function editor(page) {
  const pane = page.getByTestId("pane-primary");
  return page.locator("[data-testid='pane-primary'] .cm-content, [data-testid='editor'] .cm-content").first();
}

await page.waitForSelector('[data-testid="editor"]');
if ((await editor(page).innerText()).trim().length < 8) {
  await editor(page).click();
  await page.keyboard.type("# Launch plan\n\nDecide milestones and owners.\n");
  await page.waitForTimeout(300);
}
await shot(page, "02-note-desktop-light");
await page.locator(".tree-row").first().hover();
await page.getByTestId("tree-more").first().click();
await page.waitForSelector('[data-testid="tree-menu"]');
await shot(page, "02d-sidebar-menu-light");
await page.keyboard.press("Escape");
await page.waitForSelector('[data-testid="tree-menu"]', { state: "hidden" });
  await editor(page).click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/");
  await page.waitForSelector('[data-testid="suggest"]');
  await shot(page, "02b-slash-light");
await page.keyboard.press("Escape");
await page.keyboard.type("[[");
await page.waitForSelector('[data-testid="suggest"]');
await shot(page, "02c-wiki-light");
await page.keyboard.press("Escape");

const barBefore = await page.locator(".bar").evaluate((el) => el.getBoundingClientRect().height);
await page.getByTestId("note-title").click();
await page.waitForSelector('[data-testid="note-title-input"]');
const barAfter = await page.locator(".bar").evaluate((el) => el.getBoundingClientRect().height);
await shot(page, "03-title-editing");
if (Math.abs(barAfter - barBefore) > 1) {
  console.warn(`title edit shifted the header: ${barBefore}px -> ${barAfter}px`);
}
await page.getByTestId("note-title-input").press("Escape");

const strip = page.getByTestId("tab-strip");
await strip.waitFor();
const stripH = await strip.evaluate((el) => el.getBoundingClientRect().height);
if (Math.abs(stripH - 36) > 3) console.warn(`tab strip height ${stripH}px`);
await page.getByRole("button", { name: "More actions" }).click();
const fav = page.getByTestId("favorite");
if ((await fav.getAttribute("aria-pressed")) !== "true") await fav.click();
else await page.keyboard.press("Escape");
const treeLinks = page.locator(".tree-link");
if ((await treeLinks.count()) > 1) {
  await treeLinks.nth(1).click();
} else {
  await page.keyboard.press("Control+Shift+KeyO");
  await page.waitForSelector('[data-testid="picker"]');
  await page.getByTestId("picker-input").fill("Second tab");
  await page.getByTestId("picker-create").click();
}
await page.waitForSelector('[data-testid="editor"]');
  await page.waitForTimeout(200);
  await shot(page, "14-tabs-light");

  await openPicker(page);
  const homeChrome = await pickerChrome(page);
  await shot(page, "18-picker-light");
  await page.getByTestId("picker-recent").click();
  await page.waitForSelector('[data-testid="picker-back"]');
  sameChrome(homeChrome, await pickerChrome(page), "recent light");
  await shot(page, "18b-picker-recent-light");
  await page.getByTestId("picker-back").click();
  await page.waitForSelector('[data-testid="picker-favorites"]');
  await page.getByTestId("picker-favorites").click();
  await page.waitForSelector('[data-testid="picker-back"]');
  sameChrome(homeChrome, await pickerChrome(page), "favorites light");
  await shot(page, "18c-picker-favorites-light");
  await closePicker(page);

  await page.locator(".tree-row").first().hover();
await page.getByTestId("tree-more").first().click();
await page.getByTestId("tree-open-beside").click();
await page.waitForSelector('[data-testid="pane-beside"] [data-testid="editor"]');
await page.waitForFunction(() => {
  const title = document.querySelector('[data-testid="pane-beside"] [data-testid="note-title"]');
  return title && title.textContent && title.textContent !== "Note";
});
await shot(page, "16-split-light");

await noteAction(page, "history");
await page.waitForSelector('[data-testid="history-panel"]');
await shot(page, "04-history-sheet");
await closeSheet(page);

await noteAction(page, "delete-note-open");
await page.waitForSelector('[data-testid="delete-note"]');
await shot(page, "04b-delete-confirm");
await page.keyboard.press("Escape");
await page.waitForSelector('[data-testid="delete-note"]', { state: "hidden" });

await noteAction(page, "park");
await page.waitForSelector('[data-testid="park-capture"]');
await page.getByTestId("park-body").fill("Ask Jim about onboarding");
await shot(page, "05-park-capture");
await page.getByTestId("park-save").click();
await page.waitForSelector('[data-testid="parked-count"]');

await page.getByTestId("parked-count").click();
await page.waitForSelector('[data-testid="parked-panel"]');
await shot(page, "06-parked-list");
await page.getByTestId("parked-row").first().click();
await page.waitForSelector('[data-testid="parked-detail"]');
await shot(page, "07-parked-detail");
await closeSheet(page);

await page.evaluate(() => {
  localStorage.setItem("mnote-theme", "dark");
  document.documentElement.dataset.theme = "dark";
  document.documentElement.style.colorScheme = "dark";
});
await page.waitForTimeout(150);
await shot(page, "08-note-desktop-dark");
  await shot(page, "15-tabs-dark");
  await shot(page, "17-split-dark");
  await openPicker(page);
  const darkChrome = await pickerChrome(page);
  await shot(page, "19-picker-dark");
  await page.getByTestId("picker-recent").click();
  await page.waitForSelector('[data-testid="picker-back"]');
  sameChrome(darkChrome, await pickerChrome(page), "recent dark");
  await shot(page, "19b-picker-recent-dark");
  await closePicker(page);
await page.locator(".tree-row").first().hover();
await page.getByTestId("tree-more").first().click();
await page.waitForSelector('[data-testid="tree-menu"]');
await shot(page, "08c-sidebar-menu-dark");
await page.keyboard.press("Escape");
await page.waitForSelector('[data-testid="tree-menu"]', { state: "hidden" });
  await editor(page).click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/");
  await page.waitForSelector('[data-testid="suggest"]');
  await shot(page, "08b-slash-dark");
await page.keyboard.press("Escape");
await noteAction(page, "history");
await page.waitForSelector('[data-testid="history-panel"]');
await shot(page, "09-history-dark");
await desktop.close();

const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
const m = await mobile.newPage();
await m.addInitScript(() => localStorage.setItem("mnote-theme", "light"));
await login(m);
await m.waitForSelector('[data-testid="editor"]');
await shot(m, "10-note-mobile");
const wrapped = await m.evaluate(() => {
  const bar = document.querySelector(".bar");
  if (!bar) return true;
  const ys = [...bar.children].map((el) => Math.round(el.getBoundingClientRect().y));
  return Math.max(...ys) - Math.min(...ys) > 12;
});
if (wrapped) console.warn("mobile header children are not on one row");
await m.getByRole("button", { name: "More actions" }).click();
await shot(m, "11-note-mobile-menu");
await m.getByRole("button", { name: "Menu" }).click();
await shot(m, "12-note-mobile-nav");
await m.getByTestId("tree-more").first().click();
await m.waitForSelector('[data-testid="tree-menu"]');
  await shot(m, "12b-sidebar-menu-mobile");
  await m.keyboard.press("Escape");
  await m.waitForSelector('[data-testid="tree-menu"]', { state: "hidden" });
  await openPicker(m);
  await shot(m, "20-picker-mobile");
  await m.getByTestId("picker-recent").click();
  await m.waitForSelector('[data-testid="picker-back"]');
  await shot(m, "20b-picker-recent-mobile");
  await closePicker(m);
  await mobile.close();

const loginDark = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const ld = await loginDark.newPage();
await ld.addInitScript(() => {
  localStorage.setItem("mnote-theme", "dark");
  document.documentElement.dataset.theme = "dark";
  document.documentElement.style.colorScheme = "dark";
});
await ready(ld, "/login");
await shot(ld, "13-login-dark");
await loginDark.close();

await browser.close();
console.log(`visual review wrote ${out}`);
