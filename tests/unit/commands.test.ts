import { describe, expect, it } from "vitest";
import { parseInput, suggestionsFor } from "../../src/commands";

describe("parseInput", () =>
{
  it("parses commands with arguments", () =>
  {
    expect(parseInput("/remember Studies biology")).toEqual({ kind: "command", name: "remember", arg: "Studies biology" });
    expect(parseInput("/RESET confirm")).toEqual({ kind: "command", name: "reset", arg: "confirm" });
  });

  it("treats a lone unknown /word as a mistyped command", () =>
  {
    expect(parseInput("/xyz")).toEqual({ kind: "unknown-command", text: "/xyz" });
  });

  it("treats normal text as a message", () =>
  {
    expect(parseInput("What is 2/3 of 9?")).toEqual({ kind: "message", text: "What is 2/3 of 9?" });
  });
});

describe("suggestionsFor", () =>
{
  const notes = ["Studies biology", "Likes short answers"];
  const labels = (input: string) => suggestionsFor(input, notes).map((s) => s.label);

  it("lists every command for a bare slash", () =>
  {
    expect(labels("/")).toEqual(["/remember <text>", "/forget <number>", "/notes", "/clear", "/help", "/reset"]);
  });

  it("filters by prefix", () =>
  {
    expect(labels("/re")).toEqual(["/remember <text>", "/reset"]);
  });

  it("lists notes by number after /forget", () =>
  {
    expect(labels("/forget ")).toEqual(["/forget 1", "/forget 2"]);
    expect(labels("/forget 2")).toEqual(["/forget 2"]);
  });

  it("commands needing an argument do not run on Enter", () =>
  {
    const [remember] = suggestionsFor("/rem", notes);

    expect(remember).toMatchObject({ insert: "/remember ", runOnEnter: false });

    const [help] = suggestionsFor("/he", notes);

    expect(help).toMatchObject({ insert: "/help", runOnEnter: true });
  });

  it("never suggests /reset confirm", () =>
  {
    expect(labels("/reset c")).toEqual([]);
  });

  it("is empty for normal text and multi-line input", () =>
  {
    expect(labels("hello")).toEqual([]);
    expect(labels("/he\nllo")).toEqual([]);
  });
});
