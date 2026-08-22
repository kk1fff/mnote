import { describe, expect, it } from "vitest";
import { noteTree } from "./tree";

describe("noteTree", () => {
  it("nests notes under folders and sorts them", () => {
    const tree = noteTree([
      { id: "z", title: "Zeta", folder: "", modified_at: "" },
      { id: "t", title: "Two", folder: "ideas", modified_at: "" },
      { id: "o", title: "One", folder: "ideas", modified_at: "" },
      { id: "p", title: "Plan", folder: "work", modified_at: "" },
    ]);
    expect(tree).toMatchObject([
      {
        kind: "folder",
        name: "ideas",
        path: "ideas",
        children: [
          { kind: "note", name: "One", note: { id: "o" } },
          { kind: "note", name: "Two", note: { id: "t" } },
        ],
      },
      {
        kind: "folder",
        name: "work",
        path: "work",
        children: [{ kind: "note", name: "Plan", note: { id: "p" } }],
      },
      { kind: "note", name: "Zeta", note: { id: "z" } },
    ]);
  });
});
