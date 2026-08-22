import { expect, test } from "@playwright/test";
import { BOB_STATE } from "./env";
import { createNote, uid } from "./helpers";

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
