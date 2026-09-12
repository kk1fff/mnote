import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { readEnv, uid } from "./env";
import { createNote, noteAction, typeInEditor } from "./helpers";

function noteIdFromUrl(url: string): string {
  const id = new URL(url).pathname.split("/n/")[1] ?? "";
  return decodeURIComponent(id.replace(/\/+$/, ""));
}

function ageSession(noteId: string, minutes = 6) {
  const database = path.join(readEnv().data, "db", "mnote.db");
  execFileSync("python3", ["-c", `
import sqlite3, sys
with sqlite3.connect(sys.argv[1]) as db:
    changed = db.execute("UPDATE note_edit_clock SET last_edit = ? WHERE user_id = (SELECT id FROM users WHERE username = ?) AND note_id = ?", (sys.argv[3], "alice", sys.argv[2]))
    assert changed.rowcount == 1, "expected an existing edit clock"
`, database, noteId, new Date(Date.now() - minutes * 60_000).toISOString()]);
}

test("history lists a prior session and restore brings it back", async ({ page }) => {
  await page.goto("/");
  await page.waitForURL(/\/n\//);
  const title = uid("Hist");
  await createNote(page, title);
  const first = uid("v1");
  await typeInEditor(page, first);
  await noteAction(page, "save");
  await expect(page.getByTestId("note-saved-toast")).toHaveText("Saved");
  const noteId = noteIdFromUrl(page.url());
  ageSession(noteId);

  const second = uid("v2");
  await typeInEditor(page, ` ${second}`);
  await noteAction(page, "save");
  await expect(page.getByTestId("note-saved-toast")).toHaveText("Saved");

  await noteAction(page, "history");
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
