import { expect, test } from "@playwright/test";
import { BOB_STATE } from "./env";
import { createNote, uid } from "./helpers";

test("sidebar links open images and picker collections", async ({ page }) => {
  await page.goto("/");
  await page.waitForURL(/\/n\//);
  await page.getByTestId("sidebar-images").click();
  await expect(page.getByRole("heading", { name: "Images" })).toBeVisible();
  await page.goBack();
  await page.waitForURL(/\/n\//);
  await page.getByTestId("sidebar-favorites").click();
  await expect(page.getByTestId("picker-back")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByTestId("sidebar-recent").click();
  await expect(page.getByTestId("picker-back")).toBeVisible();
});

test("calendar day creates a journal", async ({ page }) => {
  await page.goto("/");
  await page.waitForURL(/\/n\//);
  await page.getByTestId("cal-next").click();
  await page.locator(".sidebar-cal-day").first().click();
  await expect(page.getByTestId("note-title")).toHaveText(/\d{4}-\d{2}-\d{2}/);
});

test("mobile menu opens and closes", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/");
  await page.waitForURL(/\/n\//);
  const shell = page.locator(".app-shell");
  await expect(shell).not.toHaveClass(/nav-open/);
  await page.getByRole("button", { name: "Menu" }).click();
  await expect(shell).toHaveClass(/nav-open/);
  await page.getByRole("button", { name: "Close menu" }).click();
  await expect(shell).not.toHaveClass(/nav-open/);
});

test("bob cannot open alice's note", async ({ page, browser }) => {
  await page.goto("/");
  await page.waitForURL(/\/n\//);
  const title = uid("Secret");
  await createNote(page, title);
  const aliceUrl = page.url();
  const bob = await browser.newContext({ storageState: BOB_STATE });
  const bobPage = await bob.newPage();
  await bobPage.goto(aliceUrl);
  await expect(bobPage.getByTestId("note-status")).toHaveText("Note not found");
  await expect(bobPage.getByTestId("sidebar")).not.toContainText(title);
  await bob.close();
});
