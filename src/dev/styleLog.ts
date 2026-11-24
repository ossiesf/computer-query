// Style-check records (dev mode only): every check, every rewrite, the timings, and your ✓/✗ label.
// Labels turn this into a hand-labeled set that measures how often the check agrees with you.
import type { StyleOutcome, StyleStep } from "../respond";
import type { StyleCheckMode } from "../types";
import { devStore } from "./devDb";

export interface StyleRunRecord
{
  id?: number;
  ts: string;
  appVersion: string;
  model: string;
  thinking: boolean;
  checkMode: StyleCheckMode;
  fix: boolean;
  question: string;
  /** The model's first answer. */
  original: string;
  /** What the user saw (the original, or a rewrite that passed). */
  shown: string;
  outcome: StyleOutcome;
  tag: string;
  steps: StyleStep[];
  /** Your judgment of the shown answer: is it in style? */
  label?: "good" | "bad";
}

export const styleLog = devStore<StyleRunRecord>("styleRuns");

export async function setStyleLabel(id: number, label: "good" | "bad" | undefined): Promise<void>
{
  const record = await styleLog.get(id);

  if (record) await styleLog.put({ ...record, label });
}

export interface Agreement
{
  /** Labeled answers the check ruled on (pass or fail). */
  total: number;
  agreed: number;
  /** The check passed it; you marked it ✗. */
  missed: number;
  /** The check failed it; you marked it ✓. */
  falseAlarms: number;
}

export interface StyleSummary
{
  runs: number;
  outcomes: Record<StyleOutcome, number>;
  avgCheckMs: number | null;
  avgFixMs: number | null;
  /** Fixes thrown away by a guard (lost code, a number, or most of the text), by reason. */
  discarded: Record<string, number>;
  agreement: Partial<Record<"model" | "rules", Agreement>>;
}

/** What the check concluded about the answer that was shown. */
function verdictOnShown(outcome: StyleOutcome): "pass" | "fail" | null
{
  if (outcome === "pass" || outcome === "fixed") return "pass";
  if (outcome === "not-fixed" || outcome === "fix-off") return "fail";

  return null; // unsure, error, unchecked: no verdict to compare
}

export function summarizeStyleRuns(records: readonly StyleRunRecord[]): StyleSummary
{
  const outcomes: Record<StyleOutcome, number> = {
    pass: 0, fixed: 0, "not-fixed": 0, "fix-off": 0, unsure: 0, error: 0, unchecked: 0,
  };
  const checkMs: number[] = [];
  const fixMs: number[] = [];
  const discarded: Record<string, number> = {};
  const agreement: StyleSummary["agreement"] = {};

  for (const r of records)
  {
    outcomes[r.outcome]++;

    for (const step of r.steps)
    {
      if (step.kind === "check" && step.method === "model") checkMs.push(step.ms);

      if (step.kind === "fix")
      {
        fixMs.push(step.ms);

        if (step.discardedBecause)
        {
          const reason = step.discardedBecause.replace(/the number .*/, "a number");

          discarded[reason] = (discarded[reason] ?? 0) + 1;
        }
      }
    }

    const verdict = verdictOnShown(r.outcome);

    if (!r.label || !verdict || r.checkMode === "off") continue;

    const a = (agreement[r.checkMode] ??= { total: 0, agreed: 0, missed: 0, falseAlarms: 0 });

    a.total++;
    if ((verdict === "pass") === (r.label === "good")) a.agreed++;
    else if (verdict === "pass") a.missed++;
    else a.falseAlarms++;
  }

  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : null);

  return { runs: records.length, outcomes, avgCheckMs: avg(checkMs), avgFixMs: avg(fixMs), discarded, agreement };
}

/** One JSON object per line: easy to load into pandas, jq, or a spreadsheet. */
export function toJsonl(records: readonly StyleRunRecord[]): string
{
  return records.map((r) => JSON.stringify(r)).join("\n");
}
