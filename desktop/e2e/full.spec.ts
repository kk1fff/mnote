import { expect, test } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { launchApp } from "./launch";

test.skip(process.platform !== "darwin", "mac only");

test("creates a local vault and reopens it", async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "mnote-vault-"));
  const first = await launchApp({ flavor: "full", data });
  await expect(first.page.getByText("Notes live in a folder")).toBeVisible();
  await first.page.getByRole("button", { name: "Choose" }).click();
  await first.page.locator('input[name="password"]').fill("password1");
  await first.page.getByRole("button", { name: "Create vault" }).click();
  await expect(first.page.getByTestId("note-title")).toBeVisible({ timeout: 30_000 });
  expect(fs.existsSync(path.join(data, "db", "mnote.db"))).toBe(true);
  expect(fs.readdirSync(path.join(data, "vaults")).length).toBeGreaterThan(0);
  await first.app.close();

  const second = await launchApp({ flavor: "full", userData: first.userData, data });
  await expect(second.page.getByTestId("note-title")).toBeVisible({ timeout: 30_000 });
  await expect(second.page.getByText("Notes live in a folder")).toHaveCount(0);
  await second.app.close();
  fs.rmSync(first.userData, { recursive: true, force: true });
  fs.rmSync(data, { recursive: true, force: true });
});
