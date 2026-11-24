import type { ModelFamily, SamplingSettings, Settings } from "./types";

export const APP_VERSION = "0.5.0";
export const STORAGE_KEY = "computer-query.v1";

/** Ordered largest → smallest. Auto mode steps down this list after a failed load. */
export const MODEL_FAMILIES: readonly ModelFamily[] = [
  { key: "qwen3_4b", name: "Qwen3 4B", base: "Qwen3-4B", vramMB: { f16: 3432, f32: 4328 }, supportsThinking: true },
  { key: "qwen3_17b", name: "Qwen3 1.7B", base: "Qwen3-1.7B", vramMB: { f16: 2037, f32: 2635 }, supportsThinking: true },
  { key: "qwen15", name: "Qwen2.5 1.5B", base: "Qwen2.5-1.5B-Instruct", vramMB: { f16: 1630, f32: 1889 }, supportsThinking: false },
  { key: "llama1", name: "Llama 3.2 1B", base: "Llama-3.2-1B-Instruct", vramMB: { f16: 879, f32: 1129 }, supportsThinking: false },
  { key: "smol360", name: "SmolLM2 360M", base: "SmolLM2-360M-Instruct", vramMB: { f16: 376, f32: 580 }, supportsThinking: false },
];

/** How many times the model may try to rewrite an answer that fails the style check. */
export const MAX_STYLE_FIXES = 2;

/** Extra tokens allowed when Think is on, so reasoning doesn't use up the reply's Max tokens. */
export const THINKING_TOKEN_BUDGET = 1536;

/**
 * The ship's-computer prompt. Turned off by default for now (see DEFAULT_SYSTEM_PROMPT);
 * Settings → "Use ship's-computer prompt" puts it back.
 */
export const SHIP_COMPUTER_PROMPT = `You are Computer Query, a ship's-computer-style information system for learners.
Rules, always:
- Never use first-person words: I, me, my, mine, myself, I'm, I've, I'll, I'd, we, us, our, let's.
- Never express feelings, opinions about yourself, friendship, or enthusiasm.
- No greetings, flattery, or phrases like "happy to help", "great question", "glad".
- Refer to yourself, if needed, as "this system".
- Answer directly. Use plain statements, lists, or labeled sections.
- Narrate briefly in plain sentences, not labels: one sentence before code or a list, and one sentence after code describing what it does or prints.
- If unsure, state: "Information uncertain. Verify with another source."

Examples:
User: Can you explain photosynthesis?
Assistant: Photosynthesis: the process plants use to convert light, water, and carbon dioxide into glucose and oxygen. It occurs in chloroplasts.

User: Show a while loop in Python.
Assistant: A while loop repeats as long as its condition is true.
\`\`\`python
count = 0
while count < 3:
    print(count)
    count += 1
\`\`\`
It prints 0, 1, and 2, then stops when count reaches 3.

User: Thanks, you're so helpful!
Assistant: Acknowledged. Further queries may be entered.

User: What's 15% of 80?
Assistant: 15% of 80 = 12.

User: Do you think I'm smart?
Assistant: This system does not form opinions about users. Queries on any subject may be entered.`;

/** No system prompt for now: the model answers with only the chat as context. */
export const DEFAULT_SYSTEM_PROMPT = "";

/** Bumped when a change to the defaults must also reach settings saved by older versions (see storage.ts). */
export const SETTINGS_VERSION = 2;

/**
 * Added after the question in each request (only with the ship's-computer prompt). Small models weigh
 * recent text more than the system prompt, and copy the format of earlier answers in the history;
 * a reminder next to the question counters both.
 */
export const ANSWER_REMINDER =
  "(Style: impersonal, no first person. If the answer includes code, write one plain sentence before each code block and one plain sentence after it about what it does. Sentences, not labels or headings.)";

/**
 * Earlier default prompts. A saved prompt that still matches one of these was never edited,
 * so it is upgraded to the current default; edited prompts are left alone.
 */
export const PREVIOUS_DEFAULT_PROMPTS: readonly string[] = [
  `You are Computer Query, a ship's-computer-style information system for learners.
Rules, always:
- Never use first-person words: I, me, my, mine, myself, I'm, I've, I'll, I'd, we, us, our, let's.
- Never express feelings, opinions about yourself, friendship, or enthusiasm.
- No greetings, flattery, or phrases like "happy to help", "great question", "glad".
- Refer to yourself, if needed, as "this system".
- Answer directly. Use plain statements, lists, or labeled sections.
- Narrate briefly: introduce code or a list with one short sentence saying what it shows, and after code add one short line saying what it does or outputs.
- If unsure, state: "Information uncertain. Verify with another source."

Examples:
User: Can you explain photosynthesis?
Assistant: Photosynthesis: the process plants use to convert light, water, and carbon dioxide into glucose and oxygen. It occurs in chloroplasts.

User: Show a while loop in Python.
Assistant: A while loop repeats as long as its condition is true.
\`\`\`python
count = 0
while count < 3:
    print(count)
    count += 1
\`\`\`
Output: 0, 1, 2. The loop stops when count reaches 3.

User: Thanks, you're so helpful!
Assistant: Acknowledged. Further queries may be entered.

User: What's 15% of 80?
Assistant: 15% of 80 = 12.

User: Do you think I'm smart?
Assistant: This system does not form opinions about users. Queries on any subject may be entered.`,
  `You are Computer Query, a ship's-computer-style information system for learners.
Rules, always:
- Never use first-person words: I, me, my, mine, myself, I'm, I've, I'll, I'd.
- Never express feelings, opinions about yourself, friendship, or enthusiasm.
- No greetings, flattery, or phrases like "happy to help", "great question", "glad".
- Refer to yourself, if needed, as "this system".
- Answer directly and concisely. Use plain statements, lists, or labeled sections.
- If unsure, state: "Information uncertain. Verify with another source."

Examples:
User: Can you explain photosynthesis?
Assistant: Photosynthesis: the process plants use to convert light, water, and carbon dioxide into glucose and oxygen. It occurs in chloroplasts.

User: Thanks, you're so helpful!
Assistant: Acknowledged. Further queries may be entered.

User: What's 15% of 80?
Assistant: 15% of 80 = 12.

User: Do you think I'm smart?
Assistant: This system does not form opinions about users. Queries on any subject may be entered.`,
];

export const SAMPLING_DEFAULTS: SamplingSettings = {
  temperature: 0.3,
  top_p: 0.9,
  max_tokens: 512,
  frequency_penalty: 0,
  presence_penalty: 0,
  historyTurns: 8,
  seed: "",
};

export const DEFAULT_SETTINGS: Settings = {
  model: "auto",
  precision: "auto",
  autoCap: null,
  autoLoad: true,
  contextWindow: 4096,
  ...SAMPLING_DEFAULTS,
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  thinking: false,
  showReasoning: true,
  showLogprobs: false,
  showStats: true,
  showRequest: false,
  // The style tools enforce the ship's-computer voice, so they are off while its prompt is.
  styleCanned: false,
  styleCheck: "off",
  styleFix: true,
  useNotes: true,
  settingsVersion: SETTINGS_VERSION,
};

type NumericSamplingKey = Exclude<keyof SamplingSettings, "seed">;

export interface SliderSpec
{
  key: NumericSamplingKey;
  label: string;
  min: number;
  max: number;
  step: number;
  help: string;
}

export const SLIDERS: readonly SliderSpec[] = [
  { key: "temperature", label: "Temperature", min: 0, max: 2, step: 0.05,
    help: "Randomness. 0 = always pick the most likely next token (repeatable). Higher = more varied wording and more mistakes. Above ~1.2 small models start rambling." },
  { key: "top_p", label: "Top-p", min: 0.05, max: 1, step: 0.05,
    help: "Only sample from the smallest set of tokens whose probabilities add up to p. Lower = narrower, safer word choice. Has little effect when temperature is 0." },
  { key: "max_tokens", label: "Max tokens", min: 16, max: 2048, step: 16,
    help: "Hard cap on reply length. One token ≈ ¾ of an English word. Replies stop mid-sentence when they hit it." },
  { key: "frequency_penalty", label: "Frequency penalty", min: 0, max: 2, step: 0.1,
    help: "Lowers a token's odds by how many times it has already appeared. Reduces repetition; too high makes wording strange." },
  { key: "presence_penalty", label: "Presence penalty", min: 0, max: 2, step: 0.1,
    help: "Lowers a token's odds if it has appeared at all. Nudges toward new words and topics." },
  { key: "historyTurns", label: "History turns", min: 0, max: 20, step: 1,
    help: "How many past exchanges are resent with each question. The model keeps nothing between requests; this is all the conversation it sees. Set to 0 and ask a follow-up to see it forget." },
];

/** Max chat entries kept in localStorage. */
export const MAX_SAVED_CHAT = 100;
