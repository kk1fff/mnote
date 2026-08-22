import { expect, test } from "@playwright/test";
import { ALICE_STATE } from "./env";
import { createNote, openPicker, secondPage, uid } from "./helpers";

test("header rename and move update the sidebar", async ({ page }) => {
  await page.goto("/");
  await page.waitForURL(/\/n\//);
  const title = uid("Meta");
  const renamed = uid("Ren");
  await createNote(page, `ideas/${title}`);
  await page.getByTestId("note-title").click();
  await page.getByTestId("note-title-input").fill(renamed);
  await page.getByTestId("note-folder-input").fill("work");
  await page.getByTestId("note-title-input").press("Enter");
  await expect(page.getByTestId("note-title")).toHaveText(renamed);
  await expect(page.getByTestId("note-folder")).toHaveText("work");
  await expect(page.getByTestId("sidebar")).toContainText(renamed);
  await expect(page.getByTestId("sidebar")).toContainText("work");
});

test("invalid title first character is rejected", async ({ page }) => {
  await page.goto("/");
  await page.waitForURL(/\/n\//);
  await createNote(page, uid("Ok"));
  await page.getByTestId("note-title").click();
  await page.getByTestId("note-title-input").fill("***");
  await page.getByTestId("note-title-input").press("Enter");
  await expect(page.getByTestId("note-status")).toContainText("title must start");
  await expect(page.getByTestId("note-title-input")).toBeVisible();
});

test("search folder fills a folder prefix", async ({ page }) => {
  await page.goto("/");
  await page.waitForURL(/\/n\//);
  const title = uid("Fld");
  await createNote(page, `ideas/${title}`);
  await openPicker(page);
  await page.getByTestId("picker-search-folder").click();
  await expect(page.getByTestId("picker")).toContainText("ideas");
  await page.getByTestId("picker").getByRole("button", { name: "ideas" }).click();
  await expect(page.getByTestId("picker-input")).toHaveValue("ideas/");
  await expect(page.getByTestId("picker")).toContainText(title);
  await page.getByTestId("picker-input").press("Escape");
  await expect(page.getByTestId("picker")).toHaveCount(0);
});

test("rename updates the other sidebar", async ({ page, browser }) => {
  await page.goto("/");
  await page.waitForURL(/\/n\//);
  const title = uid("LiveR");
  const renamed = uid("LiveN");
  await createNote(page, title);
  const other = await secondPage(browser, ALICE_STATE);
  await other.goto("/");
  await other.waitForURL(/\/n\//);
  await expect(other.getByTestId("sidebar")).toContainText(title);
  await page.getByTestId("note-title").click();
  await page.getByTestId("note-title-input").fill(renamed);
  await page.getByTestId("note-title-input").press("Enter");
  await expect(other.getByTestId("sidebar")).toContainText(renamed, { timeout: 15_000 });
  await other.context().close();
});
