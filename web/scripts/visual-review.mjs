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
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: file, fullPage: false, animations: "disabled" });
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
  const navOpen = await page.locator('.app-shell').evaluate(el => el.classList.contains('nav-open'));
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  if (!navOpen && await menu.isVisible()) await menu.click();
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

async function tagsChrome(root) {
  return root.locator(".bar").first().evaluate((bar) => {
    const folder = bar.querySelector(".note-folder");
    const tags = bar.querySelector(".note-tags");
    const preview = bar.querySelector(".preview-desktop");
    const more = bar.querySelector(".actions-more");
    const previewOn = preview && window.getComputedStyle(preview).display !== "none";
    const anchor = previewOn ? preview : more;
    const folderBox = folder?.getBoundingClientRect();
    const tagsBox = tags?.getBoundingClientRect();
    const rowBox = folder?.parentElement?.getBoundingClientRect();
    const anchorBox = anchor?.getBoundingClientRect();
    return {
      barH: bar.getBoundingClientRect().height,
      folderRight: folderBox?.right ?? 0,
      folderW: folderBox?.width ?? 0,
      rowW: rowBox?.width ?? 0,
      tagsLeft: tagsBox?.left ?? 0,
      tagsRight: tagsBox?.right ?? 0,
      actionsLeft: anchorBox?.left ?? 0,
      hasTags: Boolean(tags),
    };
  });
}

async function ensureNoteTags(page) {
  if (await page.locator('[data-testid="note-tags"]').count()) return;
  await editor(page).click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type(" #work");
  await page.keyboard.press("Escape");
  await page.waitForSelector('[data-testid="note-tags"]', { timeout: 8000 });
}

function checkTagsRow(chrome, label) {
  if (!chrome.hasTags) {
    console.warn(`tags missing on ${label}`);
    return;
  }
  if (chrome.tagsLeft + 1 < chrome.folderRight) {
    console.warn(`tags overlap folder on ${label}`);
  }
  if (chrome.tagsLeft - chrome.folderRight > 16) {
    console.warn(`tags not after folder on ${label}: gap ${chrome.tagsLeft - chrome.folderRight}px`);
  }
  if (chrome.tagsRight - chrome.actionsLeft > 1) {
    console.warn(`tags overlap actions on ${label}`);
  }
  if (chrome.folderW > chrome.rowW * 0.52 + 1) {
    console.warn(`folder wider than half with tags on ${label}`);
  }
}

const browser = await chromium.launch({ headless: true });

const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await desktop.newPage();
await page.addInitScript(() => { if (!localStorage.getItem("mnote-theme")) localStorage.setItem("mnote-theme", "light"); });
await ready(page, "/login");
await shot(page, "01-login-light");
await login(page);
function editor(page) {
  const pane = page.getByTestId("pane-primary");
  return page.locator("[data-testid='pane-primary'] .cm-content, [data-testid='editor'] .cm-content").first();
}

async function barHeight(page) {
  return page.locator(".bar").first().evaluate((el) => el.getBoundingClientRect().height);
}

async function captureSaveStatus(page, unsavedName, toastName) {
  const before = await barHeight(page);
  await editor(page).click();
  await page.keyboard.type(" ");
  await page.getByTestId("note-status").waitFor({ timeout: 3000 });
  const during = await barHeight(page);
  if (Math.abs(during - before) > 1) {
    console.warn(`unsaved overlay shifted the header on ${unsavedName}: ${before} -> ${during}`);
  }
  await shot(page, unsavedName);
  await page.getByTestId("note-saved-toast").waitFor({ timeout: 4000 });
  await shot(page, toastName);
  await page.getByTestId("note-saved-toast").waitFor({ state: "hidden", timeout: 4000 });
  const after = await barHeight(page);
  if (Math.abs(after - before) > 1) {
    console.warn(`saved toast shifted the header on ${toastName}: ${before} -> ${after}`);
  }
}

await page.waitForSelector('[data-testid="editor"]');
if ((await editor(page).innerText()).trim().length < 8) {
  await editor(page).click();
  await page.keyboard.type("# Launch plan\n\nDecide milestones and owners.\n");
  await page.waitForTimeout(300);
}
await captureSaveStatus(page, "31-unsaved-desktop-light", "32-saved-toast-desktop-light");
await shot(page, "02-note-desktop-light");

await editor(page).click();
await page.keyboard.press("End");
await page.keyboard.press("Enter");
await page.keyboard.type(" see #work");
try {
  await page.waitForSelector('[data-testid="suggest"]', { timeout: 4000 });
  await shot(page, "22-tag-suggest-light");
  await page.keyboard.press("Enter");
} catch {
  console.warn("tag suggest did not open");
}
  await noteAction(page, "save");
  try {
    await page.waitForSelector('[data-testid="note-tags"]', { timeout: 8000 });
    const tagsLight = page.locator(".note-pane").first();
    checkTagsRow(await tagsChrome(tagsLight), "light");
    await shot(page, "23-note-tags-row-light");
    await editor(page).click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type(" #home #inbox #ideas #planning #review #later");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    checkTagsRow(await tagsChrome(tagsLight), "light overflow");
    await shot(page, "23c-note-tags-overflow-light");
    await page.getByTestId("note-folder").click();
    await page.waitForSelector('[data-testid="note-folder-input"]');
    await page.getByTestId("note-folder-input").fill("projects/launch/planning/owners/and/more/nested/paths");
    await page.getByTestId("note-title-input").press("Enter");
    await page.waitForSelector('[data-testid="note-folder"]');
    checkTagsRow(await tagsChrome(tagsLight), "light long folder");
    await shot(page, "23f-note-tags-long-folder-light");
  } catch {
    console.warn("note tags row did not appear");
  }
await page.getByTestId("sidebar-cal-toggle").click();
await shot(page, "02f-sidebar-calendar-folded-light");
await page.getByTestId("sidebar-cal-toggle").click();
await page.getByTestId("sidebar-favorites").click();
await page.waitForSelector('[data-testid="picker-back"]');
await shot(page, "18d-picker-favorites-sidebar-light");
await closePicker(page);
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

await page.getByRole("button", { name: "More actions" }).click();
await page.getByTestId("insert-image").click();
await page.waitForSelector('[data-testid="asset-picker"]');
await shot(page, "02e-image-picker-light");
await closeSheet(page);

const barBefore = await page.locator(".bar").evaluate((el) => el.getBoundingClientRect().height);
await page.getByTestId("note-title").click();
await page.waitForSelector('[data-testid="note-title-input"]');
const barAfter = await page.locator(".bar").evaluate((el) => el.getBoundingClientRect().height);
  await shot(page, "03-title-editing");
  if (Math.abs(barAfter - barBefore) > 1) {
    console.warn(`title edit shifted the header: ${barBefore}px -> ${barAfter}px`);
  }
  if (await page.locator('[data-testid="note-tags"]').count()) {
    console.warn("tags still visible while editing title/folder");
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
  await page.getByTestId("picker-back").click();
  await page.waitForSelector('[data-testid="picker-tags"]');
  await page.getByTestId("picker-tags").click();
  await page.waitForSelector('[data-testid="picker-back"]');
  sameChrome(homeChrome, await pickerChrome(page), "tags light");
  await shot(page, "18e-picker-tags-light");
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
await page.getByTestId("park-body").fill("Ask Jim about onboarding #work");
await page.waitForTimeout(200);
await shot(page, "05-park-capture");
if (await page.locator('[data-testid="park-suggest"]').count()) {
  await shot(page, "24-park-tag-suggest");
}
await page.getByTestId("park-save").click();
await page.waitForSelector('[data-testid="parked-count"]');

await page.getByTestId("parked-count").click();
await page.waitForSelector('[data-testid="parked-panel"]');
await shot(page, "06-parked-list");
await page.getByTestId("parked-row").first().click();
await page.waitForSelector('[data-testid="parked-detail"]');
await shot(page, "07-parked-detail");
await closeSheet(page);

await page.goto(`${url}/images`);
await page.waitForSelector("h1");
await shot(page, "21-images-light");
await page.goBack();
await page.waitForSelector('[data-testid="editor"]');

await page.evaluate(() => {
  localStorage.setItem("mnote-theme", "dark");
  document.documentElement.dataset.theme = "dark";
  document.documentElement.style.colorScheme = "dark";
});
await page.waitForTimeout(150);
await captureSaveStatus(page, "31b-unsaved-desktop-dark", "32b-saved-toast-desktop-dark");
await shot(page, "08-note-desktop-dark");
await page.getByTestId("sidebar-cal-toggle").click();
await shot(page, "08d-sidebar-calendar-folded-dark");
await page.getByTestId("sidebar-cal-toggle").click();
  await shot(page, "15-tabs-dark");
  await shot(page, "17-split-dark");
  await openPicker(page);
  const darkChrome = await pickerChrome(page);
  await shot(page, "19-picker-dark");
  await page.getByTestId("picker-recent").click();
  await page.waitForSelector('[data-testid="picker-back"]');
  sameChrome(darkChrome, await pickerChrome(page), "recent dark");
  await shot(page, "19b-picker-recent-dark");
  await page.getByTestId("picker-back").click();
  await page.waitForSelector('[data-testid="picker-tags"]');
  await page.getByTestId("picker-tags").click();
  await page.waitForSelector('[data-testid="picker-back"]');
  await shot(page, "19c-picker-tags-dark");
  await closePicker(page);
  await ensureNoteTags(page);
  const tagsDark = page.getByTestId("pane-primary");
  checkTagsRow(await tagsChrome(tagsDark), "dark");
  await shot(page, "23b-note-tags-row-dark");
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
await closeSheet(page);
await noteAction(page, "insert-image");
await page.waitForSelector('[data-testid="asset-picker"]');
await shot(page, "09b-image-picker-dark");
await closeSheet(page);
await page.goto(`${url}/images`);
await page.waitForSelector("h1");
await shot(page, "21b-images-dark");
await desktop.close();

const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
const m = await mobile.newPage();
await m.addInitScript(() => localStorage.setItem("mnote-theme", "light"));
await login(m);
await m.waitForSelector('[data-testid="editor"]');
await captureSaveStatus(m, "31c-unsaved-mobile", "32c-saved-toast-mobile");
await shot(m, "10-note-mobile");
try {
    await ensureNoteTags(m);
    checkTagsRow(await tagsChrome(m), "mobile");
    await shot(m, "23e-note-tags-mobile");
  } catch {
    console.warn("mobile tags row did not appear");
  }
const wrapped = await m.evaluate(() => {
  const bar = document.querySelector(".bar");
  if (!bar) return true;
  const ys = [...bar.children].map((el) => Math.round(el.getBoundingClientRect().y));
  return Math.max(...ys) - Math.min(...ys) > 12;
});
if (wrapped) console.warn("mobile header children are not on one row");
await m.getByRole("button", { name: "More actions" }).click();
await shot(m, "11-note-mobile-menu");
await m.getByTestId("insert-image").click();
await m.waitForSelector('[data-testid="asset-picker"]');
await shot(m, "11b-image-picker-mobile");
await closeSheet(m);
await m.getByRole("button", { name: "Menu" }).click();
await shot(m, "12-note-mobile-nav");
await m.getByTestId("sidebar").getByRole("button", { name: "Sign out", exact: true }).scrollIntoViewIfNeeded();
await shot(m, "12c-mobile-nav-account");
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
  await m.getByTestId("picker-back").click();
  await m.waitForSelector('[data-testid="picker-tags"]');
  await m.getByTestId("picker-tags").click();
  await m.waitForSelector('[data-testid="picker-back"]');
  await shot(m, "20c-picker-tags-mobile");
  await closePicker(m);
  await m.goto(`${url}/images`);
  await m.waitForSelector("h1");
  await shot(m, "21c-images-mobile");
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

for (const mobile of [false, true]) {
  for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 } });
    const p = await context.newPage();
    await p.addInitScript(value => localStorage.setItem("mnote-theme", value), theme);
    await login(p);
    await p.waitForSelector('[data-testid="editor"]');
    const label = `${mobile ? "mobile" : "desktop"}-${theme}`;
    await shot(p, `25-workspace-${label}`);
    if (mobile) await p.getByRole("button", { name: "Menu", exact: true }).click();
    await p.getByTestId("new-note").click();
    await shot(p, `26-new-note-${label}`);
    await p.getByTestId("picker-input").fill("A thoughtful new idea with a longer title");
    await p.getByText("No matching notes. Create one below.").waitFor();
    await shot(p, `27-search-empty-${label}`);
    await p.getByRole("button", { name: "Close picker" }).click();
    if (mobile && await p.getByRole("button", { name: "Close sidebar" }).isVisible()) await p.getByRole("button", { name: "Close sidebar" }).click();
    await p.getByRole("button", { name: "More actions" }).click();
    await shot(p, `28-actions-${label}`);
    await p.keyboard.press("Escape");
    await noteAction(p, "history");
    await shot(p, `29-history-${label}`);
    await closeSheet(p);
    await openPicker(p);
    await p.getByTestId("picker-input").fill("Conflict review sample");
    const existing = p.getByTestId("picker").getByRole("button", { name: "Conflict review sample", exact: true });
    await p.waitForTimeout(250);
    if (await existing.count()) await existing.click();
    else await p.getByTestId("picker-create").click();
    await p.waitForSelector('[data-testid="editor"]');
    await p.waitForLoadState("networkidle");
    await editor(p).click();
    await p.keyboard.press("ControlOrMeta+a");
    await p.keyboard.insertText("<<<<<<< this device\nFirst idea\n=======\nSecond idea\n>>>>>>> other device");
    await noteAction(p, "save");
    await p.getByTestId("conflict-notice").waitFor();
    await shot(p, `30-conflict-${label}`);
    await context.close();
  }
}
await browser.close();
console.log(`visual review wrote ${out}`);
