// Repeat guard: small models sometimes copy their previous answer onto a new, unrelated question
// (seen on Qwen3 1.7B: a weight-loss question got the for-loop answer from earlier in the chat).
// This spots that without asking the model. Pure; no DOM.

/** Answers at least this similar to the previous one count as a repeat. */
export const REPEAT_SIMILARITY = 0.9;

/** Short replies ("Acknowledged.") legitimately repeat, so they are never flagged. */
export const MIN_REPEAT_LENGTH = 80;

export interface PreviousTurn
{
  question: string;
  answer: string;
}

/**
 * True when `answer` is nearly the same as the previous answer, but the question changed.
 * Asking the exact same question twice is allowed to get the same answer.
 */
export function isRepeat(question: string, answer: string, previous: PreviousTurn | null): boolean
{
  if (!previous) return false;
  if (answer.length < MIN_REPEAT_LENGTH) return false;
  if (normalize(question) === normalize(previous.question)) return false;

  return similarity(answer, previous.answer) >= REPEAT_SIMILARITY;
}

/** Word-pair (bigram) overlap from 0 (nothing shared) to 1 (same text), ignoring case, spacing and punctuation. */
export function similarity(a: string, b: string): number
{
  const pairsA = wordPairs(a);
  const pairsB = wordPairs(b);

  if (pairsA.size === 0 && pairsB.size === 0) return 1;

  let shared = 0;

  for (const pair of pairsA)
  {
    if (pairsB.has(pair)) shared++;
  }

  return (2 * shared) / (pairsA.size + pairsB.size);
}

function normalize(text: string): string
{
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function wordPairs(text: string): Set<string>
{
  const words = normalize(text).split(" ").filter(Boolean);
  const pairs = new Set<string>();

  for (let i = 0; i < words.length - 1; i++)
  {
    pairs.add(`${words[i]} ${words[i + 1]}`);
  }

  if (words.length === 1) pairs.add(words[0]);

  return pairs;
}
