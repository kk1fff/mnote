import { todayDate } from "./paths";

export type SlashContext = {
  query: string;
  replace: (text: string) => void;
  startPageLink: (query: string) => void;
};

export type SlashCommand = {
  id: string;
  title: string;
  hint?: string;
  keywords?: string[];
  run: (ctx: SlashContext) => void;
};

const commands: SlashCommand[] = [];

export function registerSlashCommand(command: SlashCommand) {
  if (commands.some((entry) => entry.id === command.id)) return;
  commands.push(command);
}

export function slashCommands(): SlashCommand[] {
  return commands;
}

export function commandRemainder(query: string, command: SlashCommand): string {
  const trimmed = query.trim();
  const [first, ...rest] = trimmed.split(/\s+/);
  const token = (first ?? "").toLowerCase();
  if (!token) return "";
  if (
    command.id.startsWith(token) ||
    command.title.toLowerCase().startsWith(token) ||
    (command.keywords ?? []).some((word) => word.toLowerCase().startsWith(token))
  ) {
    return rest.join(" ");
  }
  return trimmed;
}

export function matchSlashCommands(query: string): SlashCommand[] {
  const token = query.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  if (!token) return commands;
  return commands.filter(
    (command) =>
      command.id.startsWith(token) ||
      command.title.toLowerCase().startsWith(token) ||
      (command.keywords ?? []).some((word) => word.toLowerCase().startsWith(token)),
  );
}

export function formatTime(now = new Date()): string {
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

export function registerBuiltinCommands() {
  registerSlashCommand({
    id: "date",
    title: "Date",
    hint: "YYYY-MM-DD",
    keywords: ["today"],
    run: (ctx) => ctx.replace(todayDate()),
  });
  registerSlashCommand({
    id: "time",
    title: "Time",
    hint: "HH:mm",
    run: (ctx) => ctx.replace(formatTime()),
  });
  registerSlashCommand({
    id: "page",
    title: "Page",
    hint: "link a page",
    keywords: ["link", "note", "wiki"],
    run: (ctx) => {
      const page = commands.find((command) => command.id === "page");
      ctx.startPageLink(page ? commandRemainder(ctx.query, page) : "");
    },
  });
}

registerBuiltinCommands();
