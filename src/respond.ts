// Generates a reply and enforces the ship's-computer style:
//   answer → check (model or word rules) → if it fails, the model rewrites it (up to MAX_STYLE_FIXES tries).
// Before that, the repeat guard: an answer that copies the previous one onto a new question is
// generated again without the chat history (see repeat.ts).
// Failing gracefully: if no rewrite passes, or the check itself breaks, the original answer is kept.
import { MAX_STYLE_FIXES } from "./config";
import type { Generation } from "./engine";
import { isRepeat, type PreviousTurn } from "./repeat";
import { findStyleIssues, protectCode, restoreCode } from "./style";
import type { ChatMessage, StyleCheckMode, Tone } from "./types";

export interface StyleOptions
{
  check: StyleCheckMode;
  fix: boolean;
  /** Turns on the repeat guard. Leave out to skip it. */
  repeatGuard?: RepeatGuard;
  /** True once the user pressed Stop: whatever was written so far is kept, with no further steps. */
  stopped?: () => boolean;
}

export interface RepeatGuard
{
  question: string;
  /** The last question and answer in the chat, or null if this is the first question. */
  previous: PreviousTurn | null;
  /** The same request without the chat history, used to answer again. */
  withoutHistory: ChatMessage[];
}

/** The two model calls the pipeline needs; injected so tests can use a fake model. */
export interface StyleModel
{
  /** The main answer (streamed to the screen). */
  answer: (messages: ChatMessage[]) => Promise<Generation>;
  /** A short, non-streaming request: used to judge and to rewrite. */
  complete: (messages: ChatMessage[], options: { maxTokens: number; temperature: number }) => Promise<string>;
}

export type Verdict = "pass" | "fail" | "unsure";

/** One step of the check, with timing, for the tooltip and the dev-mode log. */
export type StyleStep =
  | { kind: "check"; method: "model" | "rules"; verdict: Verdict; ms: number; note: string }
  | { kind: "fix"; attempt: number; ms: number; note: string; text: string; discardedBecause?: string }
  | { kind: "repeat"; ms: number; note: string; text: string };

/** How the check ended. */
export type StyleOutcome = "pass" | "fixed" | "not-fixed" | "fix-off" | "unsure" | "error" | "unchecked";

export interface StyledReply
{
  text: string;
  generation: Generation;
  outcome: StyleOutcome;
  /** Short label shown under the reply, e.g. "style: ok". */
  tag: string;
  tone?: Tone;
  steps: StyleStep[];
  /** One readable line per step, plus a closing note when the original was kept. */
  log: string[];
  /** False when the text was rewritten, so token probabilities no longer line up. */
  matchesTokens: boolean;
}

/** On retries the request includes the failed attempt; a little randomness helps the model try something new. */
const RETRY_TEMPERATURE = 0.4;

export async function generateStyledReply(
  messages: ChatMessage[],
  model: StyleModel,
  options: StyleOptions,
  onStep?: (note: string) => void,
): Promise<StyledReply>
{
  // Every check and fix is recorded, for the tooltip and the dev-mode log.
  const steps: StyleStep[] = [];
  const log: string[] = [];
  const record = (step: StyleStep) =>
  {
    steps.push(step);
    log.push(step.note);
  };

  // Answer, and answer again without history if it copied the previous answer.
  let generation = await model.answer(messages);
  const guard = options.repeatGuard;
  let retried = false;

  const stopped = () => options.stopped?.() ?? false;

  if (guard && !stopped() && isRepeat(guard.question, generation.text, guard.previous))
  {
    onStep?.("Same answer as the last question; answering again without the chat history…");

    const started = performance.now();
    const copied = generation.text;

    generation = await model.answer(guard.withoutHistory);
    retried = true;
    record({
      kind: "repeat", ms: Math.round(performance.now() - started), text: copied,
      note: "Repeat guard: the answer copied the previous one, so it was answered again without the chat history.",
    });
  }

  const original = generation.text;

  const result = (outcome: StyleOutcome, text: string, tag: string, tone?: Tone): StyledReply => ({
    text, generation, outcome, tone, steps, log, matchesTokens: text === original,
    tag: retried ? `${tag} · answered again (repeat)` : tag,
  });

  if (stopped()) return result("unchecked", original, "stopped");
  if (options.check === "off" || !original) return result("unchecked", original, "style: not checked");

  try
  {
    onStep?.("Checking style…");

    const verdict = await judge(original, options.check, model, record);

    if (verdict === "pass") return result("pass", original, options.check === "rules" ? "style: ok (word rules)" : "style: ok");
    if (verdict === "unsure") return result("unsure", original, "style: couldn't check", "warn");
    if (!options.fix) return result("fix-off", original, "style: doesn't match (fixing is off)", "warn");

    let previous: string | null = null; // the last rewrite that was tried and failed the check

    for (let attempt = 1; attempt <= MAX_STYLE_FIXES && !stopped(); attempt++)
    {
      onStep?.(`Fixing style (try ${attempt} of ${MAX_STYLE_FIXES})…`);

      const fixed = await rewrite(original, previous, attempt, model, record);

      if (!fixed) continue;

      if ((await judge(fixed, options.check, model, record)) === "pass")
      {
        return result("fixed", fixed, "style: fixed by the model", "warn");
      }

      previous = fixed;
    }

    if (stopped()) return result("unchecked", original, "stopped");

    log.push("No fix passed, so the original answer is shown.");

    return result("not-fixed", original, "style: may not match (couldn't fix)", "warn");
  }
  catch (e)
  {
    // A broken check must never cost the user their answer.
    log.push(`The check stopped with an error: ${e instanceof Error ? e.message : e}`);

    return result("error", original, "style: couldn't check", "warn");
  }
}

// ---------- Judging ----------

const JUDGE_INSTRUCTIONS = `You check one rule. The text must read like a ship's computer: impersonal.
It FAILS if the writer talks as a person or character: first-person words (I, me, my, we, us, our, let's), feelings or enthusiasm, greetings, or praise of the reader.
These are allowed and do NOT fail: quotations, examples of how a word is used, names like "World War I", and placeholders like [[CODE_1]].
Reply with exactly one word: PASS or FAIL.`;

async function judge(
  text: string,
  mode: StyleCheckMode,
  model: StyleModel,
  record: (step: StyleStep) => void,
): Promise<Verdict>
{
  const started = performance.now();
  const ms = () => Math.round(performance.now() - started);

  if (mode === "rules")
  {
    const issues = findStyleIssues(text);
    const verdict: Verdict = issues.length ? "fail" : "pass";

    record({
      kind: "check", method: "rules", verdict, ms: ms(),
      note: issues.length ? `Word rules: found a ${issues.join(" and ")}.` : "Word rules: nothing found.",
    });

    return verdict;
  }

  const { prose } = protectCode(text);
  const reply = await model.complete(
    [
      { role: "system", content: JUDGE_INSTRUCTIONS },
      { role: "user", content: `Text:\n<<<\n${prose}\n>>>` },
    ],
    { maxTokens: 4, temperature: 0 },
  );
  const word = reply.trim().toUpperCase();
  const verdict: Verdict = word.startsWith("PASS") ? "pass" : word.startsWith("FAIL") ? "fail" : "unsure";

  record({
    kind: "check", method: "model", verdict, ms: ms(),
    note: verdict === "unsure"
      ? `Model check: unclear reply ${JSON.stringify(reply.slice(0, 40))}.`
      : `Model check: ${verdict.toUpperCase()}.`,
  });

  return verdict;
}

// ---------- Fixing ----------

const REWRITE_INSTRUCTIONS = `Rewrite the text in the voice of a ship's computer: impersonal and direct.
Remove first-person words (I, me, my, we, us, our, let's), feelings, greetings, and praise of the reader.
Keep every fact, number, list, and example. Keep each placeholder like [[CODE_1]] exactly as written, in the same place.
Output only the rewritten text.`;

/** Before/after pairs: small models follow examples far better than instructions alone. */
const REWRITE_EXAMPLES: [before: string, after: string][] = [
  [
    "Great question! I think the answer is 12, because 3 × 4 = 12.",
    "Answer: 12, because 3 × 4 = 12.",
  ],
  [
    "Sure, I'd be happy to help! Let's look at the loop: [[CODE_1]] We start at 0 and print each number. Hope this helps!",
    "The loop: [[CODE_1]] It starts at 0 and prints each number.",
  ],
];

/** Formats a rewrite request, naming the specific problems the word rules can see. */
function rewriteRequest(prose: string): string
{
  const hints = findStyleIssues(prose);
  const problems = hints.length ? `Problems found: ${hints.join("; ")}.\n` : "";

  return `${problems}Text:\n<<<\n${prose}\n>>>`;
}

/**
 * Asks the model to rewrite the prose (code is protected by placeholders). On a retry, the failed
 * rewrite is sent back so the model tries something different. Returns null if the result is unusable.
 */
async function rewrite(
  text: string,
  previous: string | null,
  attempt: number,
  model: StyleModel,
  record: (step: StyleStep) => void,
): Promise<string | null>
{
  const started = performance.now();
  const { prose, blocks } = protectCode(text);

  const messages: ChatMessage[] = [
    { role: "system", content: REWRITE_INSTRUCTIONS },
    ...REWRITE_EXAMPLES.flatMap(([before, after]): ChatMessage[] => [
      { role: "user", content: rewriteRequest(before) },
      { role: "assistant", content: after },
    ]),
    { role: "user", content: rewriteRequest(prose) },
  ];

  if (previous)
  {
    messages.push(
      { role: "assistant", content: protectCode(previous).prose },
      { role: "user", content: "That version still reads as a person. Rewrite it again: no first-person words, no feelings, no greetings. Output only the text." },
    );
  }

  const reply = await model.complete(messages, {
    maxTokens: Math.min(2048, Math.ceil(prose.length / 2) + 64), // roughly the original's length, with room to spare
    temperature: previous ? RETRY_TEMPERATURE : 0,
  });

  const restored = restoreCode(reply.trim(), blocks);
  const lostNumber = restored === null ? null : missingNumber(prose, protectCode(restored).prose);
  const discardedBecause =
    !reply.trim() ? "it was empty"
      : restored === null ? "it changed or dropped a code block"
        : restored.length < text.length * 0.4 ? "it dropped too much of the answer"
          : lostNumber !== null ? `it lost the number ${lostNumber}`
            : undefined;

  record({
    kind: "fix", attempt, ms: Math.round(performance.now() - started), text: reply.trim(), discardedBecause,
    note: discardedBecause ? `Fix ${attempt}: discarded because ${discardedBecause}.` : `Fix ${attempt}: model rewrote the answer.`,
  });

  return discardedBecause ? null : restored;
}

/** Returns a number that appears in `before` but not in `after`, or null. Facts often live in numbers. */
export function missingNumber(before: string, after: string): string | null
{
  const numbers = (s: string) => s.replace(/\[\[CODE_\d+\]\]/g, "").match(/\d+(?:[.,]\d+)*/g) ?? [];
  const kept = new Set(numbers(after));

  return numbers(before).find((n) => !kept.has(n)) ?? null;
}
