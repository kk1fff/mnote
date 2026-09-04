import { describe, expect, it } from "vitest";
import { buildPickerSections, pickerItems } from "./picker";
import type { NoteMeta } from "../api";

function note(id: string, title: string, folder = ""): NoteMeta {
  return { id, title, folder, modified_at: "" };
}

describe("buildPickerSections", () => {
  it("shows Go to and Search folder when the query is empty", () => {
    const sections = buildPickerSections({ query: "", notes: [], folders: ["ideas"] });
    expect(sections).toEqual([
      {
        id: "goto",
        label: "Go to",
        items: [
          { type: "jump", key: "today", to: "/today", label: "Today" },
          { type: "collection", key: "recent", label: "Recent" },
          { type: "collection", key: "favorites", label: "Favorites" },
          { type: "collection", key: "tags", label: "Tags" },
        ],
      },
      {
        id: "folder",
        label: "Folder",
        items: [{ type: "search-folder", key: "search-folder" }],
      },
    ]);
  });

  it("filters Go to destinations by prefix", () => {
    const sections = buildPickerSections({ query: "fav", notes: [], folders: [] });
    expect(pickerItems(sections)).toMatchObject([
      { type: "collection", key: "favorites", label: "Favorites" },
      { type: "create", label: "fav" },
    ]);
  });

  it("hides Go to in bang and folder browse", () => {
    expect(
      buildPickerSections({ query: "!", notes: [], folders: ["ideas"] }).map((section) => section.id),
    ).toEqual(["folder"]);
    expect(
      buildPickerSections({
        query: "ideas/",
        notes: [note("o1", "One", "ideas")],
        folders: [],
      }).map((section) => section.id),
    ).toEqual(["note"]);
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

  it("hides create when the folder and title match", () => {
    const sameFolder = buildPickerSections({
      query: "work/Plan",
      notes: [note("p1", "Plan", "work")],
      folders: [],
    });
    expect(sameFolder.map((section) => section.id)).toEqual(["note"]);

    const root = buildPickerSections({
      query: "Plan",
      notes: [note("p1", "Plan", "work")],
      folders: [],
    });
    expect(pickerItems(root)).toMatchObject([
      { type: "note", note: { id: "p1" } },
      { type: "create", draft: { title: "Plan", folder: "" } },
    ]);
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

  it("lists a collection with back when that mode is open", () => {
    const empty = buildPickerSections({
      query: "",
      notes: [],
      folders: [],
      collection: "recent",
    });
    expect(empty).toEqual([
      {
        id: "recent",
        label: "Recent",
        items: [{ type: "back", key: "back" }],
      },
    ]);

    const listed = buildPickerSections({
      query: "",
      notes: [note("r1", "Opened", "work")],
      folders: [],
      collection: "favorites",
    });
    expect(pickerItems(listed)).toMatchObject([
      { type: "back" },
      { type: "note", note: { id: "r1", title: "Opened" } },
    ]);
  });

  it("omits empty sections", () => {
    expect(buildPickerSections({ query: "!", notes: [], folders: [] })).toEqual([]);
    expect(buildPickerSections({ query: "ideas/", notes: [], folders: [] })).toEqual([]);
  });

  it("lists tags in the tags collection", () => {
    const notes = [note("o1", "One", "ideas")];
    notes[0].tags = ["work"];
    const listed = buildPickerSections({
      query: "",
      notes,
      folders: [],
      collection: "tags",
      tags: [{ name: "work", count: 1 }],
    });
    expect(pickerItems(listed)).toEqual([
      { type: "back", key: "back" },
      { type: "tag", key: "tag:work", name: "work", count: 1 },
    ]);
  });

  it("lists tags in hash mode and notes for an exact tag", () => {
    const notes = [note("o1", "One", "ideas")];
    notes[0].tags = ["work"];
    const listed = buildPickerSections({
      query: "#",
      notes,
      folders: [],
      tags: [{ name: "work", count: 1 }],
    });
    expect(pickerItems(listed)).toEqual([{ type: "tag", key: "tag:work", name: "work", count: 1 }]);

    const exact = buildPickerSections({
      query: "#work",
      notes,
      folders: [],
      tags: [{ name: "work", count: 1 }],
      tagHits: [{ id: "o1", title: "One", snippet: "see #work", line: 2, from: 4, to: 9 }],
    });
    expect(pickerItems(exact)).toMatchObject([
      { type: "tag-hit", id: "o1", title: "One", snippet: "see #work", line: 2 },
    ]);
  });
});
