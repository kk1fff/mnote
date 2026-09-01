import { expect, test } from "@playwright/test";
import { uid } from "./env";
import { createNote, noteAction, openPicker, typeInEditor, waitSaved } from "./helpers";

test("hashtag tags a note and picker lists it", async ({ page }) => {
  await page.goto("/");
  await page.waitForURL(/\/n\//);
  const title = uid("Tagged");
  await createNote(page, title);
  await typeInEditor(page, " see #work");
  await expect(page.getByTestId("suggest")).toBeVisible();
  await page.keyboard.press("Enter");
  await noteAction(page, "save");
  await waitSaved(page);
  await expect(page.getByTestId("note-tags")).toContainText("#work");

  await openPicker(page);
  await page.getByTestId("picker-tags").click();
  await expect(page.getByTestId("picker-tag-work")).toBeVisible();
  await page.getByTestId("picker-tag-work").click();
  await expect(page.getByTestId("picker")).toContainText(title);
});

test("parked hashtags show in the list", async ({ page }) => {
  await page.goto("/");
  await page.waitForURL(/\/n\//);
  await noteAction(page, "park");
  const dump = uid("Call");
  await page.getByTestId("park-body").fill(`${dump} #work`);
  await page.getByTestId("park-save").click();
  await page.getByTestId("parked-count").click();
  await expect(page.getByTestId("parked-row").filter({ hasText: dump })).toContainText("#work");
});
