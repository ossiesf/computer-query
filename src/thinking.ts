// Splits a reasoning model's output into its <think> block and the final answer. Pure functions.

export interface ThinkingSplit
{
  reasoning: string;
  answer: string;
  /** False while the model is still inside the <think> block. */
  reasoningDone: boolean;
}

/**
 * Qwen3 writes "<think>…</think>" before its answer. Works on partial (streaming) text too.
 * Text with no <think> block is all answer.
 */
export function splitThinking(text: string): ThinkingSplit
{
  const start = text.indexOf("<think>");

  if (start === -1) return { reasoning: "", answer: text.trim(), reasoningDone: true };

  const afterOpen = start + "<think>".length;
  const end = text.indexOf("</think>", afterOpen);

  if (end === -1) return { reasoning: text.slice(afterOpen).trim(), answer: "", reasoningDone: false };

  return {
    reasoning: text.slice(afterOpen, end).trim(),
    answer: (text.slice(0, start) + text.slice(end + "</think>".length)).trim(),
    reasoningDone: true,
  };
}

export function wordCount(text: string): number
{
  return text.split(/\s+/).filter(Boolean).length;
}
