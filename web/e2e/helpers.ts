import { expect, type Browser, type Page } from "@playwright/test";
import { ALICE_PASSWORD, TEMP_PASSWORD, uid } from "./env";

export { uid };

export async function login(page: Page, username: string, password: string) {
  if (!/\/login(?:\?|$)/.test(new URL(page.url(), "http://127.0.0.1").pathname)) {
    await page.goto("/login");
  }
  await page.locator('input[name="username"]').fill(username);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
}

export async function setPassword(page: Page, password: string) {
  await expect(page.getByRole("heading", { name: /password/i })).toBeVisible();
  await page.locator('input[name="new-password"]').fill(password);
  await page.locator('input[name="confirm-password"]').fill(password);
  await page.getByRole("button", { name: "Save" }).click();
}

export async function loginFresh(page: Page, username: string) {
  await login(page, username, TEMP_PASSWORD);
  await setPassword(page, ALICE_PASSWORD);
  await page.waitForURL(/\/n\//);
}

export async function openPicker(page: Page) {
  await page.getByRole("button", { name: "Go to…" }).click();
  await expect(page.getByTestId("picker")).toBeVisible();
}

export async function createNote(page: Page, query: string) {
  const title = query.replace(/\/+$/, "").split("/").pop() ?? query;
  await openPicker(page);
  await page.getByTestId("picker-input").fill(query);
  await expect(page.getByTestId("picker-create")).toBeVisible();
  await page.getByTestId("picker-create").click();
  await expect(page.getByTestId("picker")).toHaveCount(0);
  await expect(page.getByTestId("note-title")).toHaveText(title);
}

export async function typeInEditor(page: Page, text: string) {
  const editor = page.locator(".cm-content");
  await editor.click();
  await page.keyboard.type(text);
}

export async function editorText(page: Page): Promise<string> {
  return page.locator(".cm-content").innerText();
}

export async function waitSaved(page: Page) {
  await expect(page.getByTestId("note-status")).toHaveText(/Saved|Editing/, { timeout: 10_000 });
}

export async function secondPage(browser: Browser, storageState: string): Promise<Page> {
  const ctx = await browser.newContext({ storageState });
  return ctx.newPage();
}
