import { describe, expect, it } from "vitest";
import { preprocessPaste } from "./paste";

function ctx(beforeCursor: string, afterCursor = "") {
  return { beforeCursor, afterCursor };
}

describe("preprocessPaste", () => {
  it("strips a duplicate bullet on the first line only", () => {
    expect(preprocessPaste("- a\n- b", ctx("- "))).toEqual({ text: "a\n- b" });
    expect(preprocessPaste("* a", ctx("* "))).toEqual({ text: "a" });
    expect(preprocessPaste("+ a", ctx("+ "))).toEqual({ text: "a" });
  });

  it("strips a duplicate task marker and keeps later lines", () => {
    expect(preprocessPaste("- [ ] a\n- [ ] b", ctx("- [ ] "))).toEqual({ text: "a\n- [ ] b" });
    expect(preprocessPaste("- [ ] a", ctx("- [ ]"))).toEqual({ text: "a" });
  });

  it("uses the pasted checkbox when it differs", () => {
    expect(preprocessPaste("- [x] a\n- [ ] b", ctx("- [ ] "))).toEqual({
      text: "a\n- [ ] b",
      checkbox: true,
    });
    expect(preprocessPaste("- [ ] a", ctx("- [x] "))).toEqual({ text: "a", checkbox: false });
    expect(preprocessPaste("- [X] a", ctx("- [ ] "))).toEqual({ text: "a", checkbox: true });
  });

  it("keeps the current checkbox when the paste has no box", () => {
    expect(preprocessPaste("- a", ctx("- [ ] "))).toEqual({ text: "a" });
  });

  it("keeps a pasted task box when the current line is a plain bullet", () => {
    expect(preprocessPaste("- [x] a", ctx("- "))).toEqual({ text: "[x] a" });
  });

  it("leaves non-list lines alone", () => {
    expect(preprocessPaste("- a", ctx("hello"))).toEqual({ text: "- a" });
    expect(preprocessPaste("- a", ctx("- hello "))).toEqual({ text: "- a" });
    expect(preprocessPaste("plain", ctx("- "))).toEqual({ text: "plain" });
  });

  it("strips numbered markers and indented bullets", () => {
    expect(preprocessPaste("1. a\n2. b", ctx("1. "))).toEqual({ text: "a\n2. b" });
    expect(preprocessPaste("1) a", ctx("1) "))).toEqual({ text: "a" });
    expect(preprocessPaste("- a", ctx("  - "))).toEqual({ text: "a" });
    expect(preprocessPaste("  - a", ctx("  - "))).toEqual({ text: "a" });
  });
});
