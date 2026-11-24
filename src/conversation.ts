// Builds what is sent to the model. Pure functions.
import { ANSWER_REMINDER, SHIP_COMPUTER_PROMPT } from "./config";
import type { PreviousTurn } from "./repeat";
import type { ChatEntry, ChatMessage, Settings } from "./types";

/** The system prompt, with stored notes appended when enabled. */
export function buildSystemPrompt(settings: Settings, notes: readonly string[]): string
{
  const prompt = settings.systemPrompt.trim();

  if (!settings.useNotes || notes.length === 0) return prompt;

  const noteLines = notes.map((note) => `- ${note}`).join("\n");
  const notesBlock = `Stored notes about the user (apply when relevant, do not recite unprompted):\n${noteLines}`;

  return prompt ? `${prompt}\n\n${notesBlock}` : notesBlock;
}

/**
 * System prompt + the last `historyTurns` exchanges + the new question.
 * The model keeps nothing between requests; this list is everything it sees.
 */
export function buildMessages(
  settings: Settings,
  notes: readonly string[],
  history: readonly ChatEntry[],
  question: string,
): ChatMessage[]
{
  // Unanswered questions are left out, so the model never sees two questions in a row.
  const turns = history.filter(
    (entry): entry is Extract<ChatEntry, { role: "user" | "assistant" }> =>
      (entry.role === "user" && !entry.unanswered) || entry.role === "assistant",
  );
  const recent = settings.historyTurns > 0 ? turns.slice(-settings.historyTurns * 2) : [];
  // The reminder goes with the ship's-computer prompt only, so a custom prompt is never overridden.
  const withReminder = settings.systemPrompt === SHIP_COMPUTER_PROMPT ? `${question}\n\n${ANSWER_REMINDER}` : question;

  // An empty system prompt is left out entirely, not sent as a blank message.
  const system = buildSystemPrompt(settings, notes);

  return [
    ...(system ? [{ role: "system" as const, content: system }] : []),
    ...recent.map(({ role, content }) => ({ role, content })),
    { role: "user", content: withReminder },
  ];
}

/** The last question that got an answer, with that answer; null if there is none. Used by the repeat guard. */
export function lastAnsweredTurn(history: readonly ChatEntry[]): PreviousTurn | null
{
  for (let i = history.length - 1; i > 0; i--)
  {
    const answer = history[i];
    const question = history[i - 1];

    if (answer.role === "assistant" && question.role === "user" && !question.unanswered)
    {
      return { question: question.content, answer: answer.content };
    }
  }

  return null;
}

export interface SamplingParams
{
  temperature: number;
  top_p: number;
  max_tokens: number;
  frequency_penalty: number;
  presence_penalty: number;
  seed?: number;
}

export function samplingParams(settings: Settings): SamplingParams
{
  const params: SamplingParams = {
    temperature: settings.temperature,
    top_p: settings.top_p,
    max_tokens: settings.max_tokens,
    frequency_penalty: settings.frequency_penalty,
    presence_penalty: settings.presence_penalty,
  };
  const seed = Number.parseInt(settings.seed, 10);

  if (Number.isInteger(seed)) params.seed = seed;

  return params;
}
