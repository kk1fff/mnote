import { expect, test } from "@playwright/test";
import { uid } from "./env";
import { createNote, typeInEditor } from "./helpers";

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function isoDate(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function nextMonday(from = new Date()) {
  const date = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const delta = (1 - date.getDay() + 7) % 7;
  date.setDate(date.getDate() + delta);
  return isoDate(date);
}

test("at-date inserts a journal wiki link", async ({ page }) => {
  await page.goto("/");
  await page.waitForURL(/\/n\//);
  await createNote(page, uid("DateLink"));
  await typeInEditor(page, "@");
  await expect(page.getByTestId("date-suggest")).toBeVisible();
  await page.getByTestId("date-suggest-input").fill("mon");
  await expect(page.getByTestId("date-suggest-candidate")).toContainText("Monday");
  await page.getByTestId("date-suggest-input").press("Enter");
  await expect(page.getByTestId("date-suggest")).toHaveCount(0);
  await expect(page.locator(".cm-content")).toContainText(`[[${nextMonday()}]]`);
});

test("at-date click and escape", async ({ page }) => {
  await page.goto("/");
  await page.waitForURL(/\/n\//);
  await createNote(page, uid("DateClick"));
  await typeInEditor(page, "@");
  await expect(page.getByTestId("date-suggest")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("date-suggest")).toHaveCount(0);
  await expect(page.locator(".cm-content")).not.toContainText("@");

  await typeInEditor(page, "@");
  await expect(page.getByTestId("date-suggest")).toBeVisible();
  const today = isoDate(new Date());
  await page.getByTestId("date-suggest").getByTestId(`cal-day-${today}`).click();
  await expect(page.locator(".cm-content")).toContainText(`[[${today}]]`);
});
