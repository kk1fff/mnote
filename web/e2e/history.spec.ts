import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { readEnv, uid } from "./env";
import { createNote, typeInEditor } from "./helpers";

function noteIdFromUrl(url: string): string {
  const id = new URL(url).pathname.split("/n/")[1] ?? "";
  return decodeURIComponent(id.replace(/\/+$/, ""));
}

function ageSession(noteId: string, minutes = 6) {
  const file = path.join(readEnv().data, "vaults", "alice", "history", noteId, "last_edit");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, new Date(Date.now() - minutes * 60_000).toISOString());
}

test("history lists a prior session and restore brings it back", async ({ page }) => {
  await page.goto("/");
  await page.waitForURL(/\/n\//);
  const title = uid("Hist");
  await createNote(page, title);
  const first = uid("v1");
  await typeInEditor(page, first);
  await page.getByTestId("save").click();
  await expect(page.getByTestId("note-status")).toHaveText("Saved");
  const noteId = noteIdFromUrl(page.url());
  ageSession(noteId);

  const second = uid("v2");
  await typeInEditor(page, ` ${second}`);
  await page.getByTestId("save").click();
  await expect(page.getByTestId("note-status")).toHaveText("Saved");

  await page.getByTestId("history").click();
  await expect(page.getByTestId("history-panel")).toBeVisible();
  await expect(page.getByTestId("history-now")).toBeVisible();
  await page.getByTestId("history-row").first().click();
  await expect(page.locator(".history-preview")).toContainText(first);
  await expect(page.locator(".history-preview")).not.toContainText(second);

  await page.getByTestId("history-restore").click();
  await page.getByTestId("history-restore").click();
  await expect(page.getByTestId("history-panel")).toHaveCount(0);
  await expect(page.getByTestId("note-status")).toHaveText("Restored");
  await expect(page.locator(".cm-content")).toContainText(first);
  await expect(page.locator(".cm-content")).not.toContainText(second);
});
