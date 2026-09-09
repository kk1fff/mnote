import { describe, expect, it } from "vitest";
import { lineAt, taskBoxInLine, toggleTaskLine } from "./tasks";

describe("tasks", () => {
  it("finds the checkbox on a list line", () => {
    expect(taskBoxInLine("- [ ] buy milk")).toEqual({ from: 2, checked: false });
    expect(taskBoxInLine("  - [x] nested")).toEqual({ from: 4, checked: true });
    expect(taskBoxInLine("- [X] done")).toEqual({ from: 2, checked: true });
    expect(taskBoxInLine("- item")).toBeNull();
    expect(taskBoxInLine("1. [ ] no")).toBeNull();
  });

  it("toggles by source line", () => {
    const source = "- [ ] one\n- [x] two\n  - [ ] nested";
    expect(lineAt(source, 2)?.text).toBe("  - [ ] nested");
    expect(toggleTaskLine(source, 0)?.content).toBe("- [x] one\n- [x] two\n  - [ ] nested");
    expect(toggleTaskLine(source, 1)?.content).toBe("- [ ] one\n- [ ] two\n  - [ ] nested");
    expect(toggleTaskLine(source, 2)?.content).toBe("- [ ] one\n- [x] two\n  - [x] nested");
    expect(toggleTaskLine(source, 1)?.insert).toBe(" ");
  });

  it("leaves fenced-looking lines alone when they are not tasks at that line", () => {
    const source = "```\n- [ ] no\n```\n- [ ] yes";
    expect(toggleTaskLine(source, 3)?.content).toBe("```\n- [ ] no\n```\n- [x] yes");
    expect(toggleTaskLine(source, 9)).toBeNull();
  });
});
