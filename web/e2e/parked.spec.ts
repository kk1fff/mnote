import { expect, test } from "@playwright/test";
import { uid } from "./env";
import { createNote, typeInEditor } from "./helpers";

test("park from a note and make a note", async ({ page }) => {
  await page.goto("/");
  await page.waitForURL(/\/n\//);
  const title = uid("ParkSrc");
  await createNote(page, `ideas/${title}`);
  const marker = uid("retry");
  await typeInEditor(page, marker);
  await page.getByTestId("save").click();
  await expect(page.getByTestId("note-status")).toHaveText("Saved");

  await page.getByTestId("park").click();
  await expect(page.getByTestId("park-capture")).toBeVisible();
  const dump = uid("AskJim");
  await page.getByTestId("park-body").fill(`${dump}\nmore detail`);
  await page.getByTestId("park-save").click();
  await expect(page.getByTestId("park-capture")).toHaveCount(0);
  await expect(page.getByTestId("parked-count")).toHaveText("1 parked");
  await expect(page.locator(".cm-content")).toBeVisible();

  await page.getByTestId("parked-count").click();
  await expect(page.getByTestId("parked-panel")).toBeVisible();
  await page.getByTestId("parked-row").filter({ hasText: dump }).click();
  await expect(page.getByTestId("parked-detail")).toContainText(dump);
  await page.getByTestId("parked-open-source").click();
  await expect(page.getByTestId("note-title")).toHaveText(title);
  await expect(page.locator(".cm-content")).toContainText(marker);

  await page.getByTestId("parked-count").click();
  await page.getByTestId("parked-row").filter({ hasText: dump }).click();
  await page.getByTestId("parked-make-note").click();
  await expect(page.getByTestId("note-title")).toHaveText(dump);
  await expect(page.getByTestId("note-folder")).toHaveText("ideas");
  await expect(page.locator(".cm-content")).toContainText("Captured while in");
  await expect(page.getByTestId("parked-count")).toHaveCount(0);
});

test("quick dump and dismiss", async ({ page }) => {
  await page.goto("/quick");
  const dump = uid("Milk");
  await page.getByTestId("quick-body").fill(dump);
  await page.getByRole("button", { name: "Park" }).click();
  await expect(page.getByTestId("quick-done")).toContainText("Parked");
  await page.goto("/");
  await page.waitForURL(/\/n\//);
  await page.getByTestId("parked-count").click();
  await expect(page.getByTestId("parked-row").filter({ hasText: dump })).toContainText(
    "opened to dump",
  );
  await page.getByTestId("parked-row").filter({ hasText: dump }).click();
  await page.getByTestId("parked-dismiss").click();
  await expect(page.getByTestId("parked-panel")).toHaveCount(0);
});

test("sidebar park has no source note", async ({ page }) => {
  await page.goto("/");
  await page.waitForURL(/\/n\//);
  await page.getByTestId("sidebar-park").click();
  await expect(page.getByTestId("park-capture")).toBeVisible();
  await expect(page.getByTestId("park-capture")).not.toContainText("From ");
  const dump = uid("Loose");
  await page.getByTestId("park-body").fill(dump);
  await page.getByTestId("park-save").click();
  await page.getByTestId("parked-count").click();
  await expect(page.getByTestId("parked-row").filter({ hasText: dump })).toContainText(
    "opened to dump",
  );
});
