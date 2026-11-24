import { describe, expect, it } from "vitest";
import { isRepeat, similarity } from "../../src/repeat";

// The real failure, from Qwen3 1.7B: the weight-loss question got the loop answer again.
const LOOP_ANSWER = `Python:
\`\`\`python
for i in range(5):
    print(i)
\`\`\`
What it shows: A loop iterating from 0 to 4.
Output: 0, 1, 2, 3, 4.

Java:
\`\`\`java
for (int i = 0; i < 5; i++) {
    System.out.println(i);
}
\`\`\`
What it shows: A loop running from 0 to 4.
Output: 0, 1, 2, 3, 4.`;

const previous = { question: "i need some examples of for loops again", answer: LOOP_ANSWER };

describe("isRepeat", () =>
{
  it("flags the same answer to a different question", () =>
  {
    expect(isRepeat("I need to lose weight but I'm not sure where to start", LOOP_ANSWER, previous)).toBe(true);
  });

  it("flags a copy that differs only in spacing or a word", () =>
  {
    const nearCopy = LOOP_ANSWER.replace("iterating", "counting").replace(/\n\n/g, "\n");

    expect(isRepeat("What is a calorie?", nearCopy, previous)).toBe(true);
  });

  it("allows a different answer", () =>
  {
    const answer = "Weight loss: a sustained calorie deficit. Common starting points: track food intake, add daily walking, and prioritize protein and sleep.";

    expect(isRepeat("I need to lose weight", answer, previous)).toBe(false);
  });

  it("allows the same answer to the same question asked again", () =>
  {
    expect(isRepeat("I need some examples of for loops, again!", LOOP_ANSWER, previous)).toBe(false);
  });

  it("allows short replies to repeat", () =>
  {
    const thanks = { question: "thanks", answer: "Acknowledged. Further queries may be entered." };

    expect(isRepeat("thank you!", "Acknowledged. Further queries may be entered.", thanks)).toBe(false);
  });

  it("does nothing on the first question", () =>
  {
    expect(isRepeat("anything", LOOP_ANSWER, null)).toBe(false);
  });
});

describe("similarity", () =>
{
  it("is 1 for the same text and 0 for unrelated text", () =>
  {
    expect(similarity("a b c d", "A  b, c d")).toBe(1);
    expect(similarity("plants make sugar", "loops repeat code")).toBe(0);
  });
});
