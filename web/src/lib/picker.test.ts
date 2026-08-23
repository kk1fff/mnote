import { describe, expect, it } from "vitest";
import { buildPickerSections, pickerItems } from "./picker";
import type { NoteMeta } from "../api";

function note(id: string, title: string, folder = ""): NoteMeta {
  return { id, title, folder, modified_at: "" };
}

describe("buildPickerSections", () => {
  it("shows Search folder when the query is empty", () => {
    const sections = buildPickerSections({ query: "", notes: [], folders: ["ideas"] });
    expect(sections).toEqual([
      {
        id: "folder",
        label: "Folder",
        items: [{ type: "search-folder", key: "search-folder" }],
      },
    ]);
  });

  it("lists notes and create for a partial title", () => {
    const sections = buildPickerSections({
      query: "pla",
      notes: [note("p1", "Plan", "work")],
      folders: [],
    });
    expect(sections.map((section) => section.id)).toEqual(["note", "create"]);
    expect(pickerItems(sections)).toMatchObject([
      { type: "note", note: { id: "p1", title: "Plan" } },
      { type: "create", label: "pla", draft: { title: "pla", folder: "" } },
    ]);
  });

  it("hides create when a title matches exactly", () => {
    const sections = buildPickerSections({
      query: "Plan",
      notes: [note("p1", "Plan", "work")],
      folders: [],
    });
    expect(sections.map((section) => section.id)).toEqual(["note"]);
  });

  it("lists notes only for a trailing-slash folder browse", () => {
    const sections = buildPickerSections({
      query: "ideas/",
      notes: [note("o1", "One", "ideas"), note("w1", "Work", "work")],
      folders: [],
    });
    expect(sections).toHaveLength(1);
    expect(sections[0].id).toBe("note");
    expect(pickerItems(sections).map((item) => (item.type === "note" ? item.note.id : item.type))).toEqual([
      "o1",
    ]);
  });

  it("lists folders only in bang mode", () => {
    const all = buildPickerSections({
      query: "!",
      notes: [note("o1", "One", "ideas")],
      folders: ["ideas", "work"],
    });
    expect(all.map((section) => section.id)).toEqual(["folder"]);
    expect(pickerItems(all)).toEqual([
      { type: "folder", key: "ideas", path: "ideas" },
      { type: "folder", key: "work", path: "work" },
    ]);

    const filtered = buildPickerSections({
      query: "!ide",
      notes: [],
      folders: ["ideas", "work"],
    });
    expect(pickerItems(filtered)).toEqual([{ type: "folder", key: "ideas", path: "ideas" }]);
  });

  it("creates a note path under a folder prefix", () => {
    const sections = buildPickerSections({
      query: "ideas/alp",
      notes: [note("o1", "Alpha", "ideas")],
      folders: [],
    });
    expect(pickerItems(sections)).toMatchObject([
      { type: "note", note: { title: "Alpha" } },
      { type: "create", label: "ideas/alp", draft: { title: "alp", folder: "ideas" } },
    ]);
  });

  it("omits empty sections", () => {
    expect(buildPickerSections({ query: "!", notes: [], folders: [] })).toEqual([]);
    expect(buildPickerSections({ query: "ideas/", notes: [], folders: [] })).toEqual([]);
  });
});
