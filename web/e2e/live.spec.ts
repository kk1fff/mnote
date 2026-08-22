import { expect, test } from "@playwright/test";
import { ALICE_STATE } from "./env";
import { createNote, secondPage, typeInEditor, uid } from "./helpers";

test("two tabs live-edit the same note", async ({ page, browser }) => {
  await page.goto("/");
  await page.waitForURL(/\/n\//);
  const title = uid("Live");
  await createNote(page, title);
  const other = await secondPage(browser, ALICE_STATE);
  await other.goto(page.url());
  await expect(other.getByTestId("note-title")).toHaveText(title);
  const marker = uid("ping");
  await typeInEditor(page, marker);
  await expect(other.locator(".cm-content")).toContainText(marker, { timeout: 15_000 });
  await other.context().close();
});

test("remote caret is shown on the other tab", async ({ page, browser }) => {
  await page.goto("/");
  await page.waitForURL(/\/n\//);
  await createNote(page, uid("Caret"));
  const other = await secondPage(browser, ALICE_STATE);
  await other.goto(page.url());
  await expect(other.getByTestId("editor")).toBeVisible();
  await page.locator(".cm-content").click();
  await page.keyboard.press("ArrowRight");
  await expect(other.locator(".cm-remote-caret")).toBeVisible({ timeout: 15_000 });
  await other.context().close();
});

test("creating a note updates the other sidebar", async ({ page, browser }) => {
  await page.goto("/");
  await page.waitForURL(/\/n\//);
  const other = await secondPage(browser, ALICE_STATE);
  await other.goto("/");
  await other.waitForURL(/\/n\//);
  await expect(other.getByTestId("sidebar")).toBeVisible();
  const title = uid("Idx");
  await createNote(page, title);
  await expect(other.getByTestId("sidebar")).toContainText(title, { timeout: 15_000 });
  await other.context().close();
});

test("offline draft is kept", async ({ page, context }) => {
  await page.goto("/");
  await page.waitForURL(/\/n\//);
  await createNote(page, uid("Off"));
  await context.setOffline(true);
  const marker = uid("offline");
  await typeInEditor(page, marker);
  await expect(page.locator(".cm-content")).toContainText(marker);
  await context.setOffline(false);
  await expect(page.locator(".cm-content")).toContainText(marker);
});

test("overlapping edits keep both sides", async ({ page, browser }) => {
  await page.goto("/");
  await page.waitForURL(/\/n\//);
  await createNote(page, uid("Conf"));
  const other = await secondPage(browser, ALICE_STATE);
  await other.goto(page.url());
  await expect(other.getByTestId("editor")).toBeVisible();
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("AAAA");
  await other.locator(".cm-content").click();
  await other.keyboard.press("ControlOrMeta+A");
  await other.keyboard.type("BBBB");
  await expect
    .poll(async () => {
      const a = await page.locator(".cm-content").innerText();
      const b = await other.locator(".cm-content").innerText();
      return `${a}\n${b}`;
    }, { timeout: 15_000 })
    .toMatch(/Conflict|AAAA|BBBB|<<<<<<</);
  await other.context().close();
});
