import { describe, expect, it } from "vitest";
import { noteTree } from "./tree";

describe("noteTree", () => {
  it("nests notes under folders and sorts them", () => {
    const tree = noteTree([
      { path: "zeta", title: "Zeta", modified_at: "" },
      { path: "ideas/two", title: "Two", modified_at: "" },
      { path: "ideas/one", title: "One", modified_at: "" },
      { path: "work/plan", title: "Plan", modified_at: "" },
    ]);
    expect(tree).toMatchObject([
      {
        kind: "folder",
        name: "ideas",
        path: "ideas",
        children: [
          { kind: "note", name: "One", note: { path: "ideas/one" } },
          { kind: "note", name: "Two", note: { path: "ideas/two" } },
        ],
      },
      {
        kind: "folder",
        name: "work",
        path: "work",
        children: [{ kind: "note", name: "Plan", note: { path: "work/plan" } }],
      },
      { kind: "note", name: "Zeta", note: { path: "zeta" } },
    ]);
  });
});
