import { expect, test } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { launchApp } from "./launch";

test("opens a local folder without a password and reopens it", async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "mnote-vault-"));
  const first = await launchApp({ flavor: "full", data });
  await expect(first.page.getByText("Notes live in a folder")).toBeVisible();
  await expect(first.page.locator('input[name="password"]')).toHaveCount(0);
  await first.page.getByRole("button", { name: "Choose" }).click();
  await first.page.getByRole("button", { name: "Open" }).click();
  await expect(first.page.getByTestId("note-title")).toBeVisible({ timeout: 30_000 });
  await expect(first.page.getByTestId("sign-out")).toHaveCount(0);
  await expect(first.page.getByTestId("account-menu")).toHaveCount(0);
  await expect(first.page.getByTestId("folder-menu")).toBeVisible();
  expect(fs.existsSync(path.join(data, "db", "mnote.db"))).toBe(true);
  expect(fs.readdirSync(path.join(data, "vaults")).length).toBeGreaterThan(0);
  await first.app.close();

  const second = await launchApp({ flavor: "full", userData: first.userData, data });
  await expect(second.page.getByTestId("note-title")).toBeVisible({ timeout: 30_000 });
  await expect(second.page.getByText("Notes live in a folder")).toHaveCount(0);
  await expect(second.page.getByTestId("sign-out")).toHaveCount(0);
  await second.app.close();
  fs.rmSync(first.userData, { recursive: true, force: true });
  fs.rmSync(data, { recursive: true, force: true });
});

test("changes the notes folder", async () => {
  const firstDir = fs.mkdtempSync(path.join(os.tmpdir(), "mnote-vault-a-"));
  const secondDir = fs.mkdtempSync(path.join(os.tmpdir(), "mnote-vault-b-"));
  const app = await launchApp({ flavor: "full", data: `${firstDir}|${secondDir}` });
  await expect(app.page.getByText("Notes live in a folder")).toBeVisible();
  await app.page.getByRole("button", { name: "Choose" }).click();
  await app.page.getByRole("button", { name: "Open" }).click();
  await expect(app.page.getByTestId("note-title")).toBeVisible({ timeout: 30_000 });
  expect(fs.existsSync(path.join(firstDir, "db", "mnote.db"))).toBe(true);

  await app.page.getByTestId("folder-menu").click();
  await app.page.getByTestId("change-folder").click();
  await expect(app.page.getByText("Notes live in a folder")).toBeVisible();
  await app.page.getByRole("button", { name: "Choose" }).click();
  await app.page.getByRole("button", { name: "Open" }).click();
  await expect(app.page.getByTestId("note-title")).toBeVisible({ timeout: 30_000 });
  expect(fs.existsSync(path.join(secondDir, "db", "mnote.db"))).toBe(true);
  await app.app.close();
  fs.rmSync(app.userData, { recursive: true, force: true });
  fs.rmSync(firstDir, { recursive: true, force: true });
  fs.rmSync(secondDir, { recursive: true, force: true });
});
