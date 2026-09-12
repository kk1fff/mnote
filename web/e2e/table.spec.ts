import { expect, test } from "@playwright/test";
import { createNote, noteAction, secondPage, uid, waitSaved } from "./helpers";
import { ALICE_STATE } from "./env";

const table = "| Item | Qty |\n| --- | ---: |\n| Apples | 12 |\n| Bread | 2 |";
const source = `Before\n\n${table}\n\nAfter\n\n| Other |\n| --- |\n| untouched |`;

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.waitForURL(/\/n\//);
  await createNote(page, uid("Visual table"));
  await page.locator(".cm-content").click();
  await page.keyboard.insertText(source);
  await noteAction(page, "save");
  await waitSaved(page);
});

test("Cancel discards every draft change, preserves source and restores focus", async ({ page }) => {
  const before = await page.locator(".cm-content").innerText();
  const entry = page.getByTestId("table-edit").first();
  await entry.click();
  const sheet = page.getByTestId("table-editor");
  await page.keyboard.press("Shift+Tab");
  await expect(sheet.getByRole("button", { name: "More table actions" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(sheet.getByTestId("table-action-menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet.locator('[data-cell="0:0"]')).toBeFocused();
  await sheet.locator('[data-cell="1:0"]').dblclick();
  await sheet.locator("textarea").fill("Draft only");
  await sheet.getByRole("button", { name: "+ Row", exact: true }).click();
  await sheet.getByRole("button", { name: "+ Column", exact: true }).click();
  await sheet.getByRole("button", { name: "Sort ▾", exact: true }).click();
  await sheet.getByRole("button", { name: "Sort rows", exact: true }).click();
  await sheet.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await expect(entry).toBeFocused();
  expect(await page.locator(".cm-content").innerText()).toBe(before);
  await entry.click();
  await expect(sheet.locator('[data-cell="1:0"]')).toHaveText("Apples");
  await expect(sheet.locator("tbody tr")).toHaveCount(3);
  await sheet.getByRole("button", { name: "Apply", exact: true }).click();
  expect(await page.locator(".cm-content").innerText()).toBe(before);
  await page.reload();
  await expect(page.locator(".cm-content")).toContainText("Apples");
  expect(await page.locator(".cm-content").innerText()).toBe(before);
});

test("cell editing, sorting, alignment and structure apply, undo, preview and persist", async ({ page }) => {
  const before = await page.locator(".cm-content").innerText();
  await page.getByTestId("table-edit").first().click();
  const sheet = page.getByTestId("table-editor");
  await sheet.locator('[data-cell="1:0"]').dblclick();
  await sheet.locator("textarea").fill("**Pears**");
  await sheet.getByRole("button", { name: "Sort ▾", exact: true }).click();
  await sheet.getByLabel("Sort by", { exact: true }).selectOption("1");
  await sheet.getByRole("button", { name: "Sort rows", exact: true }).click();
  await expect(sheet.locator('[data-cell="1:0"]')).toHaveText("Bread");
  await sheet.locator('[data-cell="1:1"]').click();
  await sheet.getByRole("button", { name: "Align ▾", exact: true }).click();
  await sheet.getByRole("button", { name: "Center", exact: true }).click();
  await sheet.getByRole("button", { name: "+ Row", exact: true }).click();
  await sheet.getByRole("button", { name: "Undo table change" }).click();
  await expect(sheet.locator("tbody tr")).toHaveCount(3);
  await sheet.getByRole("button", { name: "+ Column", exact: true }).click();
  await sheet.getByRole("button", { name: "Select column C" }).click();
  await sheet.getByRole("button", { name: "Delete selected columns", exact: true }).click();
  await sheet.locator('[data-cell="0:0"]').dblclick();
  await sheet.locator("textarea").fill("Product");
  await sheet.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator(".cm-content")).toContainText("| Product | Qty |");
  await expect(page.locator(".cm-content")).toContainText("| --- | :---: |");
  await expect(page.locator(".cm-content")).toContainText("untouched");
  const after = await page.locator(".cm-content").innerText();
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+z");
  expect(await page.locator(".cm-content").innerText()).toBe(before);
  await page.keyboard.press("Control+y");
  expect(await page.locator(".cm-content").innerText()).toBe(after);
  await noteAction(page, "save");
  await waitSaved(page);
  await page.reload();
  await expect(page.locator(".cm-content")).toContainText("Product");
  expect(await page.locator(".cm-content").innerText()).toBe(after);
  await noteAction(page, "preview-toggle");
  await expect(page.locator(".preview table").first().locator("strong")).toHaveText("Pears");
  await expect(page.locator(".preview table").first().locator("tbody tr").first()).toContainText("Bread");
});

test("keyboard range paste, clear and Escape stay in the table draft", async ({ page }) => {
  await page.getByTestId("table-edit").first().click();
  const sheet = page.getByTestId("table-editor");
  await sheet.locator('[data-cell="1:0"]').click();
  await page.keyboard.press("Shift+ArrowRight");
  await expect(sheet.locator('td[aria-selected="true"]')).toHaveCount(2);
  await page.keyboard.press("Delete");
  await expect(sheet.locator('[data-cell="1:0"]')).toHaveText("");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(sheet.locator('[data-cell="1:0"]')).toHaveText("Apples");
  await sheet.locator('[data-cell="1:0"]').click();
  await sheet.locator('[data-cell="1:0"]').evaluate(el => {
    const data = new DataTransfer(); data.setData("text/plain", "X\t\tZ\nY\t4\tW\n");
    el.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
  });
  await expect(sheet.locator('[data-cell="2:2"]')).toHaveText("W");
  await page.keyboard.press("Enter");
  await sheet.locator("textarea").fill("discard this");
  await page.keyboard.press("Escape");
  await expect(sheet.locator('[data-cell="2:2"]')).toHaveText("W");
  await expect(sheet).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(page.locator(".cm-content")).toContainText("Apples");
});

test("mobile cell editor and actions remain usable in a short viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId("table-edit").first().click();
  const sheet = page.getByTestId("table-editor");
  await sheet.locator('[data-cell="1:0"]').click();
  await sheet.locator("textarea").fill("Mobile edit");
  await page.setViewportSize({ width: 390, height: 500 });
  await expect(sheet.locator("textarea")).toBeInViewport();
  await expect(sheet.getByRole("button", { name: "Apply", exact: true })).toBeInViewport();
  await sheet.getByRole("button", { name: "Next cell" }).click();
  await expect(sheet.locator("textarea")).toHaveValue("12");
  await sheet.getByRole("button", { name: "Apply", exact: true }).click();
  await noteAction(page, "save");
  await waitSaved(page);
  await page.reload();
  await expect(page.locator(".cm-content")).toContainText("Mobile edit");
});

test("a live edit to the same table preserves the local draft and blocks Apply", async ({ page, browser }) => {
  const other = await secondPage(browser, ALICE_STATE);
  try {
    await other.goto(page.url());
    await expect(other.locator(".cm-content")).toContainText("Apples");
    await page.getByTestId("table-edit").first().click();
    const sheet = page.getByTestId("table-editor");
    await sheet.locator('[data-cell="1:0"]').dblclick();
    await sheet.locator("textarea").fill("Local draft");
    await other.locator(".cm-content").click();
    await other.keyboard.press("ControlOrMeta+a");
    await other.keyboard.insertText(source.replace("Apples", "Remote edit"));
    await expect(sheet.getByRole("alert")).toContainText("Your draft is still here", { timeout: 15_000 });
    await expect(sheet.locator("textarea")).toHaveValue("Local draft");
    await expect(sheet.getByRole("button", { name: "Apply", exact: true })).toBeDisabled();
    await sheet.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.locator(".cm-content")).toContainText("Remote edit");
    await expect(page.locator(".cm-content")).not.toContainText("Local draft");
  } finally { await other.context().close(); }
});
