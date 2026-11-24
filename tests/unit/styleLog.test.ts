import { describe, expect, it } from "vitest";
import { summarizeStyleRuns, toJsonl, type StyleRunRecord } from "../../src/dev/styleLog";

function run(outcome: StyleRunRecord["outcome"], label?: "good" | "bad", extra: Partial<StyleRunRecord> = {}): StyleRunRecord
{
  return {
    ts: "2026-11-20T12:00:00Z", appVersion: "test", model: "m", thinking: false, checkMode: "model", fix: true,
    question: "q", original: "a", shown: "a", outcome, tag: "", label,
    steps: [{ kind: "check", method: "model", verdict: outcome === "pass" ? "pass" : "fail", ms: 1000, note: "" }],
    ...extra,
  };
}

describe("summarizeStyleRuns", () =>
{
  it("counts outcomes and averages timings", () =>
  {
    const s = summarizeStyleRuns([
      run("pass"),
      run("fixed", undefined, {
        steps: [
          { kind: "check", method: "model", verdict: "fail", ms: 800, note: "" },
          { kind: "fix", attempt: 1, ms: 3000, note: "", text: "x", discardedBecause: "it lost the number 12" },
          { kind: "fix", attempt: 2, ms: 2000, note: "", text: "y" },
          { kind: "check", method: "model", verdict: "pass", ms: 1200, note: "" },
        ],
      }),
    ]);

    expect(s.runs).toBe(2);
    expect(s.outcomes).toMatchObject({ pass: 1, fixed: 1 });
    expect(s.avgCheckMs).toBe(1000); // (1000 + 800 + 1200) / 3
    expect(s.avgFixMs).toBe(2500);
    expect(s.discarded).toEqual({ "it lost a number": 1 });
  });

  it("measures agreement between the check and your labels", () =>
  {
    const s = summarizeStyleRuns([
      run("pass", "good"),       // agreed
      run("fixed", "good"),      // agreed (the shown rewrite passed)
      run("pass", "bad"),        // missed: the check passed it, you said ✗
      run("not-fixed", "good"),  // false alarm: the check failed it, you said ✓
      run("not-fixed", "bad"),   // agreed
      run("unsure", "good"),     // no verdict: not counted
      run("pass"),               // unlabeled: not counted
    ]);

    expect(s.agreement.model).toEqual({ total: 5, agreed: 3, missed: 1, falseAlarms: 1 });
    expect(s.agreement.rules).toBeUndefined();
  });

  it("keeps model and word-rule agreement separate", () =>
  {
    const s = summarizeStyleRuns([run("pass", "good"), run("pass", "bad", { checkMode: "rules" })]);

    expect(s.agreement.model).toMatchObject({ total: 1, agreed: 1 });
    expect(s.agreement.rules).toMatchObject({ total: 1, missed: 1 });
  });
});

describe("toJsonl", () =>
{
  it("writes one JSON object per line", () =>
  {
    const lines = toJsonl([run("pass"), run("fixed")]).split("\n");

    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[1]).outcome).toBe("fixed");
  });
});
