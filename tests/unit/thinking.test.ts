import { describe, expect, it } from "vitest";
import { splitThinking } from "../../src/thinking";

describe("splitThinking", () =>
{
  it("separates reasoning from the answer", () =>
  {
    expect(splitThinking("<think>\nI should add 2 and 2.\n</think>\n\n2 + 2 = 4.")).toEqual({
      reasoning: "I should add 2 and 2.",
      answer: "2 + 2 = 4.",
      reasoningDone: true,
    });
  });

  it("handles a reasoning block that is still streaming", () =>
  {
    expect(splitThinking("<think>First, I need")).toEqual({ reasoning: "First, I need", answer: "", reasoningDone: false });
  });

  it("treats text without a think block as all answer", () =>
  {
    expect(splitThinking("Photosynthesis: light to sugar.")).toEqual({
      reasoning: "", answer: "Photosynthesis: light to sugar.", reasoningDone: true,
    });
  });

  it("drops the empty block a model emits when thinking is off", () =>
  {
    expect(splitThinking("<think>\n\n</think>\n\nAnswer.")).toEqual({ reasoning: "", answer: "Answer.", reasoningDone: true });
  });

  it("keeps first person inside the reasoning out of the answer", () =>
  {
    expect(splitThinking("<think>I think it is 4.</think>4.").answer).toBe("4.");
  });
});
