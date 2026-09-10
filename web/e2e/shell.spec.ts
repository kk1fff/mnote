import { expect, test } from "@playwright/test";
import { BOB_STATE } from "./env";
import { createNote, uid } from "./helpers";

test("sidebar library and organize destinations open", async ({ page }) => {
  await page.goto("/");
  await page.waitForURL(/\/n\//);
  await page.getByTestId("sidebar-notes").click();
  await expect(page.getByRole("heading", { name: "Notes" })).toBeVisible();
  await expect(page).toHaveURL(/\/notes/);
  await page.getByTestId("sidebar-images").click();
  await expect(page.getByRole("heading", { name: "Images" })).toBeVisible();
  await page.goto("/");
  await page.waitForURL(/\/n\//);
  await page.getByTestId("sidebar-favorites").click();
  await expect(page.getByTestId("picker-back")).toBeVisible();
  await page.getByRole("button", { name: "Close picker" }).click();
  await expect(page.getByTestId("picker")).toHaveCount(0);
  await expect(page.getByTestId("sidebar")).toContainText("Recent");
});

test("desktop sidebar folds to an icon rail", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.waitForURL(/\/n\//);
  const sidebar = page.getByTestId("sidebar");
  await expect(sidebar).toContainText("Recent");
  await page.getByTestId("sidebar-fold").click();
  await expect(page.locator(".app-shell")).toHaveClass(/sidebar-folded/);
  await expect(sidebar.getByText("Recent")).toBeHidden();
  await page.getByTestId("sidebar-fold").click();
  await expect(sidebar).toContainText("Recent");
});

test("calendar day creates a journal", async ({ page }) => {
  await page.goto("/");
  await page.waitForURL(/\/n\//);
  await page.getByTestId("sidebar-cal-toggle").click();
  await page.getByTestId("cal-next").click();
  const day = page.locator(".sidebar-cal-day").first();
  const date = (await day.getAttribute("data-testid"))?.replace("cal-day-", "") ?? "";
  await day.click();
  await expect(page.getByTestId("note-title")).toHaveAttribute("data-journal-date", date);
  await expect(page.locator(".bar").first()).not.toHaveClass(/is-compact/);
  await expect(page.getByTestId("journal-crumb-month")).toBeVisible();
  await page.getByTestId("journal-crumb-month").click();
  await expect(page).toHaveURL(/\/journal\?year=\d+&month=\d+/);
  await expect(page.getByRole("heading", { name: "Journal" })).toBeVisible();
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


test("account controls remain reachable in a short mobile drawer", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/");
  await page.waitForURL(/\/n\//);
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  const signOut = page.getByTestId("sidebar").getByRole("button", { name: "Sign out", exact: true });
  await signOut.scrollIntoViewIfNeeded();
  await expect(signOut).toBeInViewport();
  const search = page.getByRole("button", { name: "Search notes", exact: true });
  await search.scrollIntoViewIfNeeded();
  await expect(search).toBeInViewport();
});
