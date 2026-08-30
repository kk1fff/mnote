import { expect, test } from "@playwright/test";
import fs from "node:fs";
import { ALICE_PASSWORD, E2E_URL } from "./env";
import { launchApp } from "./launch";

test.skip(process.platform !== "darwin", "mac only");

test("connects to a server, logs in, and reopens with the saved session", async () => {
  const first = await launchApp({ flavor: "remote" });
  await expect(first.page.getByText("Connect to your server")).toBeVisible();
  await first.page.locator('input[name="server"]').fill("127.0.0.1:1");
  await first.page.getByRole("button", { name: "Connect" }).click();
  await expect(first.page.getByText("Can't reach the server.")).toBeVisible();

  await first.page.locator('input[name="server"]').fill(E2E_URL.replace(/^https?:\/\//, ""));
  await first.page.getByRole("button", { name: "Connect" }).click();
  await expect(first.page.locator('input[name="username"]')).toBeVisible();
  await first.page.locator('input[name="username"]').fill("alice");
  await first.page.locator('input[name="password"]').fill(ALICE_PASSWORD);
  await first.page.getByRole("button", { name: "Log in" }).click();
  await expect(first.page.getByTestId("note-title")).toBeVisible({ timeout: 20_000 });
  await first.app.close();

  const second = await launchApp({ flavor: "remote", userData: first.userData });
  await expect(second.page.getByTestId("note-title")).toBeVisible({ timeout: 20_000 });
  await second.app.close();
  fs.rmSync(first.userData, { recursive: true, force: true });
});
