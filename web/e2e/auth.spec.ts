import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { ALICE_PASSWORD, TEMP_PASSWORD, readEnv, uid } from "./env";
import { login, setPassword } from "./helpers";

test("first login sets a different password and opens today", async ({ page }) => {
  const { bin, data } = readEnv();
  const user = uid("carol").replace(/[^a-z0-9_-]/gi, "").slice(0, 32);
  execFileSync(bin, ["--data", data, "user", "add", user, "--password", TEMP_PASSWORD]);
  await login(page, user, TEMP_PASSWORD);
  await expect(page.getByRole("heading", { name: "Set your password" })).toBeVisible();
  await setPassword(page, ALICE_PASSWORD);
  await page.waitForURL(/\/n\//);
  await expect(page.getByTestId("note-title")).toBeVisible();
});

test("login next returns to the requested note", async ({ page }) => {
  await page.goto("/n/missing");
  await page.waitForURL(/\/login/);
  expect(page.url()).toContain("next=");
  await login(page, "alice", ALICE_PASSWORD);
  await page.waitForURL(/\/n\/missing/);
  await expect(page.getByTestId("note-status")).toHaveText("Note not found");
});

test("bad login stays on login with an error", async ({ page }) => {
  await login(page, "alice", "wrong-password");
  await expect(page.getByText("Invalid username or password")).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test("change password keeps the session", async ({ page }) => {
  await login(page, "alice", ALICE_PASSWORD);
  await page.waitForURL(/\/n\//);
  await page.getByRole("button", { name: "Account" }).click();
  await page.getByRole("menuitem", { name: "Account" }).click();
  await expect(page.getByRole("heading", { name: "Change password" })).toBeVisible();
  const next = "alicepass2";
  await setPassword(page, next);
  await page.waitForURL(/\/n\//);
  await page.getByRole("button", { name: "Account" }).click();
  await page.getByRole("menuitem", { name: "Account" }).click();
  await setPassword(page, ALICE_PASSWORD);
  await page.waitForURL(/\/n\//);
});

test("sign out requires login again", async ({ page }) => {
  await login(page, "alice", ALICE_PASSWORD);
  await page.waitForURL(/\/n\//);
  await page.getByRole("button", { name: "Account" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await page.waitForURL(/\/login/);
  await page.goto("/today");
  await page.waitForURL(/\/login/);
});

test("must_change_password user is sent to set password", async ({ page }) => {
  await login(page, "dave", TEMP_PASSWORD);
  await expect(page.getByRole("heading", { name: "Set your password" })).toBeVisible();
  await page.goto("/today");
  await expect(page.getByRole("heading", { name: "Set your password" })).toBeVisible();
});
