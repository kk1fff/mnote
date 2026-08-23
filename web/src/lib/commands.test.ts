import { describe, expect, it } from "vitest";
import { commandRemainder, formatTime, matchSlashCommands, slashCommands } from "./commands";
import { todayDate } from "./paths";

describe("commands", () => {
  it("registers date, time, and page", () => {
    expect(slashCommands().map((command) => command.id)).toEqual(["date", "time", "page"]);
  });

  it("filters by the first token", () => {
    expect(matchSlashCommands("").map((command) => command.id)).toEqual(["date", "time", "page"]);
    expect(matchSlashCommands("d").map((command) => command.id)).toEqual(["date"]);
    expect(matchSlashCommands("page Meeting").map((command) => command.id)).toEqual(["page"]);
    expect(matchSlashCommands("xyz")).toEqual([]);
  });

  it("keeps leftover query after the command name", () => {
    const page = slashCommands().find((command) => command.id === "page");
    expect(page).toBeTruthy();
    if (!page) return;
    expect(commandRemainder("page Meeting", page)).toBe("Meeting");
    expect(commandRemainder("p", page)).toBe("");
  });

  it("inserts date and time", () => {
    const date = slashCommands().find((command) => command.id === "date");
    const time = slashCommands().find((command) => command.id === "time");
    let out = "";
    date?.run({ query: "date", replace: (text) => (out = text), startPageLink: () => undefined });
    expect(out).toBe(todayDate());
    time?.run({ query: "time", replace: (text) => (out = text), startPageLink: () => undefined });
    expect(out).toBe(formatTime());
  });
});
