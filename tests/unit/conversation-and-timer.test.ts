import { describe, expect, it } from "vitest";
import { ANSWER_REMINDER, DEFAULT_SETTINGS, PREVIOUS_DEFAULT_PROMPTS, SHIP_COMPUTER_PROMPT } from "../../src/config";
import { buildMessages, lastAnsweredTurn, samplingParams } from "../../src/conversation";
import { LoadTimer } from "../../src/dev/loadTimer";
import { migrateSettings } from "../../src/storage";
import type { ChatEntry } from "../../src/types";

describe("buildMessages", () =>
{
  const history: ChatEntry[] = [
    { role: "user", content: "q1" },
    { role: "assistant", content: "a1" },
    { role: "note", content: "Note 1 stored" },
    { role: "user", content: "q2" },
    { role: "assistant", content: "a2" },
  ];

  it("sends system prompt, recent turns (no notes-to-self), and the question", () =>
  {
    const messages = buildMessages({ ...DEFAULT_SETTINGS, systemPrompt: SHIP_COMPUTER_PROMPT, historyTurns: 1 }, [], history, "q3");

    expect(messages.map((m) => `${m.role}:${m.role === "system" ? "…" : m.content.split("\n")[0]}`)).toEqual([
      "system:…", "user:q2", "assistant:a2", "user:q3",
    ]);
  });

  it("leaves unanswered questions out of the history", () =>
  {
    const withUnanswered: ChatEntry[] = [
      { role: "user", content: "lost question", unanswered: true },
      { role: "note", content: "Not answered: no model is loaded." },
      ...history,
    ];
    const sent = buildMessages(DEFAULT_SETTINGS, [], withUnanswered, "q3").map((m) => m.content);

    expect(sent).not.toContain("lost question");
  });

  it("adds the format reminder after the question, but only with the ship's-computer prompt", () =>
  {
    const ship = { ...DEFAULT_SETTINGS, systemPrompt: SHIP_COMPUTER_PROMPT };

    expect(buildMessages(ship, [], history, "q3").at(-1)!.content).toBe(`q3\n\n${ANSWER_REMINDER}`);
    expect(buildMessages({ ...DEFAULT_SETTINGS, systemPrompt: "Be a pirate." }, [], history, "q3").at(-1)!.content).toBe("q3");
    expect(buildMessages(DEFAULT_SETTINGS, [], history, "q3").at(-1)!.content).toBe("q3");
    // Earlier questions in the history are sent as asked, without the reminder.
    expect(buildMessages(ship, [], history, "q3").filter((m) => m.content.includes(ANSWER_REMINDER))).toHaveLength(1);
  });

  it("by default sends no system prompt, only the chat", () =>
  {
    const sent = buildMessages(DEFAULT_SETTINGS, [], history, "q3");

    expect(sent.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant", "user"]);
    expect(sent.at(-1)!.content).toBe("q3");
  });

  it("with no system prompt, saved notes are still sent on their own", () =>
  {
    const sent = buildMessages(DEFAULT_SETTINGS, ["Prefers Python."], [], "q");

    expect(sent[0]).toEqual({ role: "system", content: expect.stringMatching(/^Stored notes about the user.*\n- Prefers Python\.$/s) });
  });

  it("historyTurns 0 sends no history", () =>
  {
    expect(buildMessages({ ...DEFAULT_SETTINGS, historyTurns: 0 }, [], history, "q3")).toHaveLength(1);
  });

  it("appends notes to the system prompt only when enabled", () =>
  {
    const on = buildMessages(DEFAULT_SETTINGS, ["Studies biology"], [], "q")[0].content;
    const off = buildMessages({ ...DEFAULT_SETTINGS, useNotes: false }, ["Studies biology"], [], "q")[0].content;

    expect(on).toContain("- Studies biology");
    expect(off).not.toContain("Studies biology");
  });
});

describe("samplingParams", () =>
{
  it("includes seed only when it is an integer", () =>
  {
    expect(samplingParams({ ...DEFAULT_SETTINGS, seed: "" })).not.toHaveProperty("seed");
    expect(samplingParams({ ...DEFAULT_SETTINGS, seed: "42" }).seed).toBe(42);
  });
});

describe("LoadTimer", () =>
{
  it("times each phase until the next one starts", () =>
  {
    let now = 0;
    const timer = new LoadTimer(() => now);

    now = 100; timer.onProgress("Fetching param cache[1/3]: 300MB fetched.");
    now = 900; timer.onProgress("Fetching param cache[3/3]: 900MB fetched.");
    now = 1000; timer.onProgress("Loading model from cache[1/2]: 900MB loaded.");
    now = 1200; timer.onProgress("Loading GPU shader modules[1/10]");
    now = 1500; timer.onProgress("Finish loading on WebGPU");
    now = 1510;

    expect(timer.finish()).toEqual({
      totalMs: 1510, firstProgressMs: 100, downloadedMB: 900,
      downloadMs: 900, cacheToGpuMs: 200, shadersMs: 300,
    });
  });

  it("reports the running phase in a snapshot", () =>
  {
    let now = 0;
    const timer = new LoadTimer(() => now);

    now = 50; timer.onProgress("Loading GPU shader modules[1/10]");
    now = 250;
    expect(timer.snapshot()).toMatchObject({ current: "shaders", shadersMs: 200 });
  });
});

describe("migrateSettings", () =>
{
  it("upgrades old saved settings", () =>
  {
    const s = migrateSettings({ model: "SmolLM2-360M-Instruct-q4f16_1-MLC", vCheck: false, useMemory: false });

    expect(s.model).toBe("smol360");
    expect(s.styleCheck).toBe("off");
    expect(s.useNotes).toBe(false);
    expect(s).not.toHaveProperty("vCheck");
  });

  it("turns the v0.5 style switches into the model-based check", () =>
  {
    const s = migrateSettings({ systemPrompt: "Edited.", styleCheck: true, styleRegenerate: false, styleRewrite: true });

    expect(s.styleCheck).toBe("model");
    expect(s.styleFix).toBe(true);
    expect(s).not.toHaveProperty("styleRegenerate");
    expect(s).not.toHaveProperty("styleRewrite");
  });

  it("v2: an unedited ship's-computer prompt (current or older) is turned off with its style tools", () =>
  {
    for (const old of [SHIP_COMPUTER_PROMPT, ...PREVIOUS_DEFAULT_PROMPTS])
    {
      expect(migrateSettings({ systemPrompt: old, styleCheck: "model", styleCanned: true })).toMatchObject({
        systemPrompt: "", styleCheck: "off", styleCanned: false, settingsVersion: 2,
      });
    }
  });

  it("v2: an edited prompt and its style settings are kept as they are", () =>
  {
    expect(migrateSettings({ systemPrompt: "My own prompt.", styleCheck: "model", styleCanned: true })).toMatchObject({
      systemPrompt: "My own prompt.", styleCheck: "model", styleCanned: true, settingsVersion: 2,
    });
  });

  it("v2 settings are left alone, so the ship's-computer prompt can be turned back on", () =>
  {
    const chosen = { systemPrompt: SHIP_COMPUTER_PROMPT, styleCheck: "model", styleCanned: true, settingsVersion: 2 };

    expect(migrateSettings(chosen)).toMatchObject(chosen);
  });

  it("the ship's-computer prompt asks for brief narration and shows a code example", () =>
  {
    expect(SHIP_COMPUTER_PROMPT).toContain("Narrate briefly in plain sentences, not labels");
    expect(SHIP_COMPUTER_PROMPT).toContain("```python\ncount = 0");
  });
});

describe("lastAnsweredTurn", () =>
{
  it("finds the last question that got an answer", () =>
  {
    const history: ChatEntry[] = [
      { role: "user", content: "q1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "q2", unanswered: true },
      { role: "note", content: "Model loaded." },
    ];

    expect(lastAnsweredTurn(history)).toEqual({ question: "q1", answer: "a1" });
  });

  it("is null before anything was answered", () =>
  {
    expect(lastAnsweredTurn([])).toBeNull();
    expect(lastAnsweredTurn([{ role: "user", content: "q1", unanswered: true }])).toBeNull();
  });
});
