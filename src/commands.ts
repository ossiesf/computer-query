// Slash commands: definitions, parsing, and autocomplete suggestions. Pure functions.

export type CommandName = "remember" | "forget" | "notes" | "clear" | "help" | "reset";

export interface CommandSpec
{
  name: CommandName;
  /** Argument placeholder shown in the menu; commands without one run on Enter. */
  argHint?: string;
  description: string;
}

export const COMMANDS: readonly CommandSpec[] = [
  { name: "remember", argHint: "<text>", description: "Store a note that is added to every prompt" },
  { name: "forget", argHint: "<number>", description: "Delete a stored note" },
  { name: "notes", description: "List stored notes" },
  { name: "clear", description: "Clear chat history (notes and settings kept)" },
  { name: "help", description: "List commands" },
  { name: "reset", description: "Delete everything: chat, notes, settings, downloaded models (asks to confirm)" },
];

export type ParsedInput =
  | { kind: "command"; name: CommandName; arg: string }
  | { kind: "unknown-command"; text: string }
  | { kind: "message"; text: string };

export function parseInput(text: string): ParsedInput
{
  const match = text.match(/^\/(\w+)\b\s*([\s\S]*)$/);

  if (!match) return { kind: "message", text };

  const name = match[1].toLowerCase();
  const command = COMMANDS.find((c) => c.name === name);

  if (command) return { kind: "command", name: command.name, arg: match[2].trim() };

  // A lone "/word" is a mistyped command; "/ something longer" is treated as a message.
  return /^\/\S*$/.test(text) ? { kind: "unknown-command", text } : { kind: "message", text };
}

export function helpText(): string
{
  return "Commands:\n" + COMMANDS.map((c) => `/${c.name}${c.argHint ? " " + c.argHint : ""} — ${c.description}`).join("\n");
}

export interface Suggestion
{
  /** Text placed in the input when accepted. */
  insert: string;
  label: string;
  description: string;
  /** If true, accepting with Enter runs it immediately. */
  runOnEnter: boolean;
}

/** Autocomplete options for the current input. Empty means hide the menu. */
export function suggestionsFor(input: string, notes: readonly string[]): Suggestion[]
{
  if (!input.startsWith("/") || input.includes("\n")) return [];

  // After "/forget ", offer the stored notes by number.
  const forget = input.match(/^\/forget\s+(\d*)$/i);

  if (forget)
  {
    if (notes.length === 0) return [{ insert: input, label: "/forget", description: "No notes stored", runOnEnter: false }];

    return notes
      .map((note, i) => ({ insert: `/forget ${i + 1}`, label: `/forget ${i + 1}`, description: note, runOnEnter: true }))
      .filter((s) => String(s.label.split(" ")[1]).startsWith(forget[1]));
  }

  // Once the command name is complete and an argument has started, stop suggesting.
  if (/\s/.test(input)) return [];

  const typed = input.slice(1).toLowerCase();

  return COMMANDS.filter((c) => c.name.startsWith(typed)).map((c) => ({
    insert: `/${c.name}${c.argHint ? " " : ""}`,
    label: `/${c.name}${c.argHint ? " " + c.argHint : ""}`,
    description: c.description,
    runOnEnter: !c.argHint,
  }));
}
