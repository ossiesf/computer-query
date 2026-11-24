import { describe, expect, it } from "vitest";
import type { Generation } from "../../src/engine";
import { generateStyledReply, missingNumber, type StyleModel, type StyleOptions } from "../../src/respond";
import type { ChatMessage } from "../../src/types";

const modelCheck: StyleOptions = { check: "model", fix: true };

/**
 * A fake model: `answer` returns the given text; `complete` answers judge requests from
 * `verdicts` and rewrite requests from `rewrites`, in order. Every call is recorded.
 */
function fakeModel(answer: string, script: { verdicts?: string[]; rewrites?: (string | Error)[] } = {})
{
  const verdicts = [...(script.verdicts ?? [])];
  const rewrites = [...(script.rewrites ?? [])];
  const calls: { kind: "judge" | "rewrite"; messages: ChatMessage[]; temperature: number; input: string }[] = [];

  const model: StyleModel = {
    answer: async (): Promise<Generation> => ({ text: answer, reasoning: "", tokens: [], usage: null, request: "" }),
    complete: async (messages, options) =>
    {
      const isJudge = messages[0].content.includes("PASS or FAIL");
      const input = messages.map((m) => m.content).join("\n");

      calls.push({ kind: isJudge ? "judge" : "rewrite", messages, temperature: options.temperature, input });

      const next = isJudge ? verdicts.shift() : rewrites.shift();

      if (next instanceof Error) throw next;
      if (next === undefined) throw new Error(`fake model ran out of ${isJudge ? "verdicts" : "rewrites"}`);

      return next;
    },
  };

  return { model, calls };
}

describe("generateStyledReply", () =>
{
  it("keeps an answer the model judges in style", async () =>
  {
    const { model, calls } = fakeModel("Photosynthesis: light to sugar.", { verdicts: ["PASS"] });
    const reply = await generateStyledReply([], model, modelCheck);

    expect(reply).toMatchObject({ outcome: "pass", text: "Photosynthesis: light to sugar.", tag: "style: ok", matchesTokens: true });
    expect(calls.map((c) => c.kind)).toEqual(["judge"]);
  });

  it("lets the model fix a failing answer", async () =>
  {
    const { model } = fakeModel("I think plants make sugar.", { verdicts: ["FAIL", "PASS"], rewrites: ["Plants make sugar."] });
    const reply = await generateStyledReply([], model, modelCheck);

    expect(reply).toMatchObject({ text: "Plants make sugar.", tag: "style: fixed by the model", tone: "warn", matchesTokens: false });
    expect(reply.log).toEqual(["Model check: FAIL.", "Fix 1: model rewrote the answer.", "Model check: PASS."]);
  });

  it("tries a second fix, then keeps the original if neither passes", async () =>
  {
    const { model } = fakeModel("I think plants make sugar.", {
      verdicts: ["FAIL", "FAIL", "FAIL"],
      rewrites: ["We think plants make sugar.", "Our view: plants make sugar."],
    });
    const reply = await generateStyledReply([], model, modelCheck);

    expect(reply).toMatchObject({ text: "I think plants make sugar.", tag: "style: may not match (couldn't fix)", tone: "warn" });
    expect(reply.log.at(-1)).toBe("No fix passed, so the original answer is shown.");
  });

  it("never lets a fix change code", async () =>
  {
    const answer = "I wrote a loop:\n```py\nfor i in range(5):\n    print(i)\n```";
    const { model, calls } = fakeModel(answer, {
      verdicts: ["FAIL", "PASS"],
      rewrites: ["A loop:\n[[CODE_1]]"],
    });
    const reply = await generateStyledReply([], model, modelCheck);

    expect(reply.text).toBe("A loop:\n```py\nfor i in range(5):\n    print(i)\n```");
    // The model never saw the code itself, only a placeholder.
    expect(calls.every((c) => !c.input.includes("range(5)"))).toBe(true);
    expect(missingNumber("count to 5", "count to five")).toBe("5");
  });

  it("discards a fix that drops a code block", async () =>
  {
    const answer = "I wrote a loop:\n```py\nprint(1)\n```";
    const { model } = fakeModel(answer, { verdicts: ["FAIL"], rewrites: ["A loop.", "A loop."] });
    const reply = await generateStyledReply([], model, modelCheck);

    expect(reply.text).toBe(answer);
    expect(reply.log).toContain("Fix 1: discarded because it changed or dropped a code block.");
  });

  it("discards a fix that loses most of the answer", async () =>
  {
    const answer = "I can explain: photosynthesis turns light, water, and carbon dioxide into glucose and oxygen in chloroplasts.";
    const { model } = fakeModel(answer, { verdicts: ["FAIL"], rewrites: ["Light.", "Light."] });
    const reply = await generateStyledReply([], model, modelCheck);

    expect(reply.text).toBe(answer);
    expect(reply.log).toContain("Fix 1: discarded because it dropped too much of the answer.");
  });

  it("an unclear verdict keeps the answer, marked as unchecked", async () =>
  {
    const { model } = fakeModel("Plants make sugar.", { verdicts: ["Sure! The text looks fine."] });
    const reply = await generateStyledReply([], model, modelCheck);

    expect(reply).toMatchObject({ text: "Plants make sugar.", tag: "style: couldn't check", tone: "warn" });
  });

  it("an error during the check never loses the answer", async () =>
  {
    const { model } = fakeModel("I think plants make sugar.", { verdicts: ["FAIL"], rewrites: [new Error("GPU lost")] });
    const reply = await generateStyledReply([], model, modelCheck);

    expect(reply).toMatchObject({ text: "I think plants make sugar.", tag: "style: couldn't check" });
    expect(reply.log.at(-1)).toBe("The check stopped with an error: GPU lost");
  });

  it("with fixing off, a failing answer is shown and labeled", async () =>
  {
    const { model } = fakeModel("I think so.", { verdicts: ["FAIL"] });
    const reply = await generateStyledReply([], model, { check: "model", fix: false });

    expect(reply).toMatchObject({ text: "I think so.", tag: "style: doesn't match (fixing is off)" });
  });

  it("word-rules mode needs no model call to pass", async () =>
  {
    const { model, calls } = fakeModel("Plants make sugar.");
    const reply = await generateStyledReply([], model, { check: "rules", fix: true });

    expect(reply.tag).toBe("style: ok (word rules)");
    expect(calls).toEqual([]);
  });

  it("with the check off, returns the raw answer", async () =>
  {
    const { model, calls } = fakeModel("I think so.");
    const reply = await generateStyledReply([], model, { check: "off", fix: true });

    expect(reply).toMatchObject({ text: "I think so.", tag: "style: not checked" });
    expect(calls).toEqual([]);
  });

  it("a second try sends back the failed rewrite and adds a little randomness", async () =>
  {
    const { model, calls } = fakeModel("I think plants make sugar.", {
      verdicts: ["FAIL", "FAIL", "PASS"],
      rewrites: ["We think plants make sugar.", "Plants make sugar."],
    });
    const reply = await generateStyledReply([], model, modelCheck);

    expect(reply).toMatchObject({ outcome: "fixed", text: "Plants make sugar." });

    const [first, second] = calls.filter((c) => c.kind === "rewrite");

    expect(first.temperature).toBe(0);
    expect(second.temperature).toBeGreaterThan(0);
    expect(second.messages.at(-2)).toEqual({ role: "assistant", content: "We think plants make sugar." });
    expect(second.messages.at(-1)?.content).toContain("still reads as a person");
  });

  it("tells the rewrite which words were the problem, and shows it examples", async () =>
  {
    const { model, calls } = fakeModel("Great question! I think it is 12.", { verdicts: ["FAIL", "PASS"], rewrites: ["Answer: 12."] });

    await generateStyledReply([], model, modelCheck);

    const rewrite = calls.find((c) => c.kind === "rewrite")!;

    expect(rewrite.messages.at(-1)?.content).toContain('Problems found: first-person word "I"; emotional phrase "Great question"');
    expect(rewrite.messages.filter((m) => m.role === "assistant").length).toBeGreaterThanOrEqual(2); // before/after examples
  });

  it("discards a fix that loses a number", async () =>
  {
    const answer = "I think the boiling point of water is 100 °C at sea level.";
    const { model } = fakeModel(answer, {
      verdicts: ["FAIL", "PASS"],
      rewrites: ["Water boils at sea level.", "Water boils at 100 °C at sea level."],
    });
    const reply = await generateStyledReply([], model, modelCheck);

    expect(reply.log).toContain("Fix 1: discarded because it lost the number 100.");
    expect(reply).toMatchObject({ outcome: "fixed", text: "Water boils at 100 °C at sea level." });
  });

  it("records each step with its timing", async () =>
  {
    const { model } = fakeModel("I think so.", { verdicts: ["FAIL", "PASS"], rewrites: ["So it is."] });
    const reply = await generateStyledReply([], model, modelCheck);

    expect(reply.steps.map((s) => s.kind)).toEqual(["check", "fix", "check"]);
    expect(reply.steps.every((s) => s.ms >= 0)).toBe(true);
    expect(reply.steps[1]).toMatchObject({ kind: "fix", attempt: 1, text: "So it is." });
  });
});

describe("repeat guard", () =>
{
  const LOOP = "Python loops repeat code a fixed number of times. ".repeat(3);
  const withHistory: ChatMessage[] = [{ role: "user", content: "with history" }];
  const withoutHistory: ChatMessage[] = [{ role: "user", content: "without history" }];

  /** Answers from `answers` in order and records which request each answer was for. */
  function answeringModel(answers: string[])
  {
    const requests: ChatMessage[][] = [];
    const model: StyleModel = {
      answer: async (messages) =>
      {
        requests.push(messages);

        return { text: answers.shift() ?? "", reasoning: "", tokens: [], usage: null, request: "" };
      },
      complete: async () => "PASS",
    };

    return { model, requests };
  }

  const guard = (question: string) => ({
    question,
    previous: { question: "show loops", answer: LOOP },
    withoutHistory,
  });

  it("answers again without history when the answer copies the previous one", async () =>
  {
    const { model, requests } = answeringModel([LOOP, "Weight loss: a sustained calorie deficit."]);
    const reply = await generateStyledReply(withHistory, model, { ...modelCheck, repeatGuard: guard("I need to lose weight") });

    expect(requests).toEqual([withHistory, withoutHistory]);
    expect(reply).toMatchObject({ text: "Weight loss: a sustained calorie deficit.", tag: "style: ok · answered again (repeat)" });
    expect(reply.steps[0]).toMatchObject({ kind: "repeat", text: LOOP });
    expect(reply.log[0]).toMatch(/^Repeat guard:/);
  });

  it("keeps a new answer as it is", async () =>
  {
    const { model, requests } = answeringModel(["Weight loss: a sustained calorie deficit."]);
    const reply = await generateStyledReply(withHistory, model, { ...modelCheck, repeatGuard: guard("I need to lose weight") });

    expect(requests).toHaveLength(1);
    expect(reply.tag).toBe("style: ok");
  });

  it("still works when the style check is off", async () =>
  {
    const { model, requests } = answeringModel([LOOP, "Weight loss: a sustained calorie deficit."]);
    const reply = await generateStyledReply(withHistory, model, { check: "off", fix: false, repeatGuard: guard("lose weight") });

    expect(requests).toHaveLength(2);
    expect(reply.tag).toBe("style: not checked · answered again (repeat)");
  });
});

describe("Stop", () =>
{
  it("keeps the partial answer and skips the repeat guard, check and fixes", async () =>
  {
    const LOOP = "Python loops repeat code a fixed number of times. ".repeat(3);
    const { model, calls } = fakeModel(LOOP, { verdicts: ["FAIL"] });
    const reply = await generateStyledReply([], model, {
      ...modelCheck,
      stopped: () => true,
      repeatGuard: { question: "new question", previous: { question: "old", answer: LOOP }, withoutHistory: [] },
    });

    expect(reply).toMatchObject({ text: LOOP, tag: "stopped", outcome: "unchecked" });
    expect(calls).toHaveLength(0);
  });
});
