import { expect, test } from "@playwright/test";
import { uid } from "./env";
import { createNote, noteAction, openPicker, typeInEditor } from "./helpers";

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

test("bang searches folders", async ({ page }) => {
  await page.goto("/");
  await page.waitForURL(/\/n\//);
  const title = uid("Bang");
  await createNote(page, `ideas/${title}`);
  await openPicker(page);
  await page.getByTestId("picker-input").fill("!");
  await expect(page.getByTestId("picker")).toContainText("ideas");
  await page.getByTestId("picker-input").fill("!ide");
  await expect(page.getByTestId("picker")).toContainText("ideas");
  await page.getByTestId("picker-input").press("Enter");
  await expect(page.getByTestId("picker-input")).toHaveValue("ideas/");
  await expect(page.getByTestId("picker")).toContainText(title);
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
  await noteAction(page, "save");
  await expect(page.getByTestId("note-status")).toHaveText("Saved");
  await page.reload();
  await expect(page.locator(".cm-content")).toContainText(marker);
});

test("preview shows markdown and source returns", async ({ page }) => {
  await page.goto("/");
  await page.waitForURL(/\/n\//);
  await createNote(page, uid("Prev"));
  await typeInEditor(page, "hello **bold**");
  await noteAction(page, "preview-toggle");
  await expect(page.locator(".preview strong")).toHaveText("bold");
  await noteAction(page, "preview-toggle");
  await expect(page.getByTestId("editor")).toBeVisible();
});

test("wiki link opens an existing note", async ({ page }) => {
  await page.goto("/");
  await page.waitForURL(/\/n\//);
  const target = uid("WikiT");
  await createNote(page, target);
  await createNote(page, uid("WikiS"));
  await typeInEditor(page, `see [[${target}]]`);
  await noteAction(page, "preview-toggle");
  await page.locator(`a[data-wiki="${target}"]`).click();
  await expect(page.getByTestId("note-title")).toHaveText(target);
});

test("wiki link creates a missing note", async ({ page }) => {
  await page.goto("/");
  await page.waitForURL(/\/n\//);
  const missing = uid("WikiM");
  await createNote(page, uid("WikiFrom"));
  await typeInEditor(page, `see [[${missing}]]`);
  await noteAction(page, "preview-toggle");
  await page.locator(`a[data-wiki="${missing}"]`).click();
  await page.waitForURL(/\/n\//);
  await expect(page.getByTestId("note-title")).toHaveText(missing);
});

test("delete warns about backlinks and leaves the link", async ({ page }) => {
  await page.goto("/");
  await page.waitForURL(/\/n\//);
  const target = uid("DelT");
  const source = uid("DelS");
  await createNote(page, target);
  await createNote(page, source);
  await typeInEditor(page, `[[${target}]]`);
  await noteAction(page, "save");
  await expect(page.getByTestId("note-status")).toHaveText("Saved");
  await openPicker(page);
  await page.getByTestId("picker-input").fill(target);
  await page.getByTestId("picker").getByRole("button", { name: target }).click();
  await expect(page.getByTestId("note-title")).toHaveText(target);
  await expect(page.locator(".backlinks")).toContainText(source);
  await noteAction(page, "delete-note-open");
  await expect(page.getByTestId("delete-note")).toContainText(source);
  await page.getByTestId("delete-note-confirm").click();
  await page.waitForURL(/\/n\//);
  await expect(page.getByTestId("sidebar")).not.toContainText(target);
  await openPicker(page);
  await page.getByTestId("picker-input").fill(source);
  await page.getByTestId("picker").getByRole("button", { name: source }).click();
  await expect(page.getByTestId("note-title")).toHaveText(source);
  await expect(page.locator(".cm-content")).toContainText(`[[${target}]]`);
});

test("sidebar row menu deletes a note", async ({ page }) => {
  await page.goto("/");
  await page.waitForURL(/\/n\//);
  const title = uid("SideDel");
  await createNote(page, title);
  const row = page.getByTestId("sidebar").locator(".tree-row", { hasText: title });
  await row.hover();
  await row.getByTestId("tree-more").click();
  await page.getByTestId("tree-delete").click();
  await expect(page.getByTestId("delete-note")).toBeVisible();
  await page.getByTestId("delete-note-confirm").click();
  await page.waitForURL(/\/today|\/n\//);
  await expect(page.getByTestId("sidebar")).not.toContainText(title);
});

test("backlinks list the linking note", async ({ page }) => {
  await page.goto("/");
  await page.waitForURL(/\/n\//);
  const target = uid("BackT");
  const source = uid("BackS");
  await createNote(page, target);
  await createNote(page, source);
  await typeInEditor(page, `[[${target}]]`);
  await noteAction(page, "save");
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
  await noteAction(page, "favorite");
  await openPicker(page);
  await page.getByTestId("picker").getByRole("button", { name: "Favorites" }).click();
  await expect(page.getByRole("heading", { name: "Favorites" })).toBeVisible();
  await expect(page.locator(".results")).toContainText(title);
  await page.getByRole("main").getByRole("link", { name: title }).click();
  await noteAction(page, "favorite");
  await openPicker(page);
  await page.getByTestId("picker").getByRole("button", { name: "Favorites" }).click();
  await expect(page.locator(".results")).not.toContainText(title);
});

test("recent lists an opened note", async ({ page }) => {
  await page.goto("/");
  await page.waitForURL(/\/n\//);
  const title = uid("Rec");
  await createNote(page, title);
  await openPicker(page);
  await page.getByTestId("picker").getByRole("button", { name: "Recent" }).click();
  await expect(page.getByRole("heading", { name: "Recent notes" })).toBeVisible();
  await expect(page.locator(".results")).toContainText(title);
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

test("tree collapse persists across navigation and reload", async ({ page }) => {
  await page.goto("/");
  await page.waitForURL(/\/n\//);
  const title = uid("Keep");
  await createNote(page, `ideas/${title}`);
  const folder = () => page.getByTestId("sidebar").getByRole("button", { name: /ideas/ });
  await folder().click();
  await expect(page.getByTestId("sidebar").getByRole("link", { name: title })).toHaveCount(0);
  await page.goto("/search");
  await expect(page.getByRole("heading", { name: "Search" })).toBeVisible();
  await expect(page.getByTestId("sidebar").getByRole("link", { name: title })).toHaveCount(0);
  await expect(folder()).toContainText("▸");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Search" })).toBeVisible();
  await expect(page.getByTestId("sidebar").getByRole("link", { name: title })).toHaveCount(0);
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

test("slash date inserts today", async ({ page }) => {
  await page.goto("/");
  await page.waitForURL(/\/n\//);
  await createNote(page, uid("Slash"));
  await typeInEditor(page, "/date");
  await expect(page.getByTestId("suggest")).toBeVisible();
  await page.keyboard.press("Enter");
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  await expect(page.locator(".cm-content")).toContainText(today);
});

test("page command inserts a folder wiki path", async ({ page }) => {
  await page.goto("/");
  await page.waitForURL(/\/n\//);
  const target = uid("LinkT");
  await createNote(page, `ideas/${target}`);
  await createNote(page, uid("LinkS"));
  await typeInEditor(page, `/page ${target}`);
  await expect(page.getByTestId("suggest")).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("suggest")).toContainText(target);
  await page.getByTestId("suggest").getByText(target, { exact: true }).click();
  await expect(page.locator(".cm-content")).toContainText(`[[ideas/${target}]]`);
});

test("wiki create row inserts a link without creating", async ({ page }) => {
  await page.goto("/");
  await page.waitForURL(/\/n\//);
  await createNote(page, uid("From"));
  const missing = uid("NewPg");
  const created: string[] = [];
  page.on("request", (req) => {
    if (req.method() === "POST" && new URL(req.url()).pathname === "/api/notes") {
      created.push(req.url());
    }
  });
  await typeInEditor(page, `[[${missing}`);
  await expect(page.getByTestId("suggest")).toContainText(`Create “${missing}”`);
  await page.getByTestId("suggest").getByText(`Create “${missing}”`).click();
  await expect(page.locator(".cm-content")).toContainText(`[[${missing}]]`);
  expect(created).toEqual([]);
});
