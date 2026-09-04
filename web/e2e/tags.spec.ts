import { expect, test } from "@playwright/test";
import { uid } from "./env";
import { createNote, noteAction, openPicker, typeInEditor, waitSaved } from "./helpers";

test("hashtag tags a note and picker lists the line", async ({ page }) => {
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
  const hit = page.getByTestId("picker-tag-hit");
  await expect(hit).toContainText(title);
  await expect(hit).toContainText("L");
  await expect(hit).toContainText("#work");
  await hit.click();
  await expect(page.getByTestId("picker")).toHaveCount(0);
  await expect(page.locator(".cm-tag-flash")).toBeVisible();
});

test("removing the last hashtag drops the tag", async ({ page }) => {
  await page.goto("/");
  await page.waitForURL(/\/n\//);
  const title = uid("Untag");
  const tag = uid("gone").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 20) || "gone";
  await createNote(page, title);
  await typeInEditor(page, ` see #${tag}`);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("note-tags")).toContainText(`#${tag}`);
  await noteAction(page, "save");
  await waitSaved(page);

  const editor = page.locator(".cm-content");
  await editor.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.insertText("plain");
  await expect(page.getByTestId("note-tags")).toHaveCount(0);
  await noteAction(page, "save");
  await waitSaved(page);

  await openPicker(page);
  await page.getByTestId("picker-tags").click();
  await expect(page.getByTestId(`picker-tag-${tag}`)).toHaveCount(0);
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
