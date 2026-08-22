import { expect, test } from "@playwright/test";
import { uid } from "./env";
import { createNote, openPicker, typeInEditor } from "./helpers";

test("today opens a dated note", async ({ page }) => {
  await page.goto("/");
  await page.waitForURL(/\/n\//);
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  await expect(page.getByTestId("note-title")).toHaveText(today);
});

test("missing note shows not found", async ({ page }) => {
  await page.goto("/n/missing");
  await expect(page.getByTestId("note-status")).toHaveText("Note not found");
  await expect(page).toHaveURL(/\/n\/missing/);
});

test("picker creates a note in a folder", async ({ page }) => {
  await page.goto("/");
  await page.waitForURL(/\/n\//);
  const title = uid("Alpha");
  await createNote(page, `ideas/${title}`);
  await expect(page.getByTestId("note-title")).toHaveText(title);
  await expect(page.getByTestId("sidebar")).toContainText(title);
  await expect(page.getByTestId("sidebar")).toContainText("ideas");
});

test("picker opens an existing title without create", async ({ page }) => {
  await page.goto("/");
  await page.waitForURL(/\/n\//);
  const title = uid("Exact");
  await createNote(page, title);
  const url = page.url();
  await openPicker(page);
  await page.getByTestId("picker-input").fill(title);
  await expect(page.getByTestId("picker")).toContainText(title);
  await expect(page.getByTestId("picker-create")).toHaveCount(0);
  await page.getByTestId("picker").locator(".picker-results").getByRole("button", { name: title }).click();
  await expect(page).toHaveURL(url);
});

test("trailing slash browses a folder", async ({ page }) => {
  await page.goto("/");
  await page.waitForURL(/\/n\//);
  const title = uid("Browse");
  await createNote(page, `ideas/${title}`);
  await openPicker(page);
  await page.getByTestId("picker-input").fill("ideas/");
  await expect(page.getByTestId("picker")).toContainText(title);
  await expect(page.getByTestId("picker-create")).toHaveCount(0);
  await expect(page.getByTestId("picker")).toContainText("Type a name to create in ideas/");
});

test("creating an existing title opens that note", async ({ page }) => {
  await page.goto("/");
  await page.waitForURL(/\/n\//);
  const title = uid("Dup");
  await createNote(page, title);
  const url = page.url();
  await openPicker(page);
  await page.getByTestId("picker-input").fill(title);
  await expect(page.getByTestId("picker-create")).toHaveCount(0);
  await page.getByTestId("picker-input").press("Enter");
  await expect(page).toHaveURL(url);
});

test("save keeps content after reload", async ({ page }) => {
  await page.goto("/");
  await page.waitForURL(/\/n\//);
  const title = uid("Save");
  await createNote(page, title);
  const marker = uid("body");
  await typeInEditor(page, marker);
  await page.getByTestId("save").click();
  await expect(page.getByTestId("note-status")).toHaveText("Saved");
  await page.reload();
  await expect(page.locator(".cm-content")).toContainText(marker);
});

test("preview shows markdown and source returns", async ({ page }) => {
  await page.goto("/");
  await page.waitForURL(/\/n\//);
  await createNote(page, uid("Prev"));
  await typeInEditor(page, "hello **bold**");
  await page.getByTestId("preview-toggle").click();
  await expect(page.locator(".preview strong")).toHaveText("bold");
  await page.getByTestId("preview-toggle").click();
  await expect(page.getByTestId("editor")).toBeVisible();
});

test("wiki link opens an existing note", async ({ page }) => {
  await page.goto("/");
  await page.waitForURL(/\/n\//);
  const target = uid("WikiT");
  await createNote(page, target);
  await createNote(page, uid("WikiS"));
  await typeInEditor(page, `see [[${target}]]`);
  await page.getByTestId("preview-toggle").click();
  await page.locator(`a[data-wiki="${target}"]`).click();
  await expect(page.getByTestId("note-title")).toHaveText(target);
});

test("wiki link creates a missing note", async ({ page }) => {
  await page.goto("/");
  await page.waitForURL(/\/n\//);
  const missing = uid("WikiM");
  await createNote(page, uid("WikiFrom"));
  await typeInEditor(page, `see [[${missing}]]`);
  await page.getByTestId("preview-toggle").click();
  await page.locator(`a[data-wiki="${missing}"]`).click();
  await page.waitForURL(/\/n\//);
  await expect(page.getByTestId("note-title")).toHaveText(missing);
});

test("backlinks list the linking note", async ({ page }) => {
  await page.goto("/");
  await page.waitForURL(/\/n\//);
  const target = uid("BackT");
  const source = uid("BackS");
  await createNote(page, target);
  await createNote(page, source);
  await typeInEditor(page, `[[${target}]]`);
  await page.getByTestId("save").click();
  await expect(page.getByTestId("note-status")).toHaveText("Saved");
  await openPicker(page);
  await page.getByTestId("picker-input").fill(target);
  await page.getByTestId("picker").getByRole("button", { name: target }).click();
  await expect(page.getByTestId("note-title")).toHaveText(target);
  await expect(page.locator(".backlinks")).toContainText(source);
});

test("favorite appears on favorites then unfavorite removes it", async ({ page }) => {
  await page.goto("/");
  await page.waitForURL(/\/n\//);
  const title = uid("Fav");
  await createNote(page, title);
  await page.getByTestId("favorite").click();
  await page.getByRole("link", { name: "Favorites" }).click();
  await expect(page.getByRole("heading", { name: "Favorites" })).toBeVisible();
  await expect(page.locator(".results")).toContainText(title);
  await page.getByRole("main").getByRole("link", { name: title }).click();
  await page.getByTestId("favorite").click();
  await page.getByRole("link", { name: "Favorites" }).click();
  await expect(page.locator(".results")).not.toContainText(title);
});

test("recent lists an opened note", async ({ page }) => {
  await page.goto("/");
  await page.waitForURL(/\/n\//);
  const title = uid("Rec");
  await createNote(page, title);
  await page.getByRole("link", { name: "Recent" }).click();
  await expect(page.getByRole("heading", { name: "Recent notes" })).toBeVisible();
  await expect(page.locator(".results")).toContainText(title);
});

test("sidebar search finds note body", async ({ page }) => {
  await page.goto("/");
  await page.waitForURL(/\/n\//);
  const title = uid("Srch");
  const needle = uid("needle");
  await createNote(page, title);
  await typeInEditor(page, needle);
  await page.getByTestId("save").click();
  await expect(page.getByTestId("note-status")).toHaveText("Saved");
  await page.getByLabel("Search notes").fill(needle);
  await page.getByLabel("Search notes").press("Enter");
  await page.waitForURL(new RegExp(`/search\\?q=${encodeURIComponent(needle)}`));
  await expect(page.getByRole("main")).toContainText(title);
});

test("tree collapse and open a note", async ({ page }) => {
  await page.goto("/");
  await page.waitForURL(/\/n\//);
  const title = uid("Tree");
  await createNote(page, `ideas/${title}`);
  const folder = page.getByTestId("sidebar").getByRole("button", { name: /ideas/ });
  await expect(page.getByTestId("sidebar")).toContainText(title);
  await folder.click();
  await expect(page.getByTestId("sidebar").getByRole("link", { name: title })).toHaveCount(0);
  await folder.click();
  await page.getByTestId("sidebar").getByRole("link", { name: title }).click();
  await expect(page.getByTestId("note-title")).toHaveText(title);
});

test("pasting a png inserts an asset", async ({ page }) => {
  await page.goto("/");
  await page.waitForURL(/\/n\//);
  await createNote(page, uid("Img"));
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  await page.locator(".cm-content").click();
  await page.evaluate(async (bytes) => {
    const file = new File([new Uint8Array(bytes)], "dot.png", { type: "image/png" });
    const dt = new DataTransfer();
    dt.items.add(file);
    document.querySelector(".cm-content")?.dispatchEvent(
      new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dt }),
    );
  }, [...png]);
  await expect(page.locator(".cm-content")).toContainText("/api/assets/");
});
