// Shared types used across the app.

export type Precision = "f16" | "f32";
export type FamilyKey = "qwen3_4b" | "qwen3_17b" | "qwen15" | "llama1" | "smol360";

/** One model, available in two precisions. */
export interface ModelFamily
{
  key: FamilyKey;
  name: string;
  /** WebLLM model ID without the quantization suffix, e.g. "Qwen2.5-1.5B-Instruct". */
  base: string;
  /** GPU memory needed, from WebLLM's prebuilt model list. */
  vramMB: Record<Precision, number>;
  /** Can reason in a <think> block before answering (Qwen3). */
  supportsThinking: boolean;
}

export interface SamplingSettings
{
  temperature: number;
  top_p: number;
  max_tokens: number;
  frequency_penalty: number;
  presence_penalty: number;
  historyTurns: number;
  /** Kept as a string so the input can be blank (= random). */
  seed: string;
}

/** "model": the loaded model judges each answer; "rules": word lists only; "off": no check. */
export type StyleCheckMode = "model" | "rules" | "off";

export interface Settings extends SamplingSettings
{
  model: FamilyKey | "auto";
  precision: Precision | "auto";
  /** After a failed load in Auto mode, Auto never picks a model larger than this. */
  autoCap: FamilyKey | null;
  autoLoad: boolean;
  contextWindow: number;
  systemPrompt: string;
  /** Think toggle: reason step by step before answering (models that support it). */
  thinking: boolean;
  showReasoning: boolean;
  showLogprobs: boolean;
  showStats: boolean;
  showRequest: boolean;
  styleCanned: boolean;
  /** How answers are checked for the ship's-computer style. */
  styleCheck: StyleCheckMode;
  /** If the check fails, let the model rewrite the answer (up to MAX_STYLE_FIXES tries). */
  styleFix: boolean;
  useNotes: boolean;
  /** Which defaults these settings were saved with (see SETTINGS_VERSION). */
  settingsVersion: number;
}

/** [token text, log probability, top alternatives as [text, logprob]] */
export type TokenInfo = [token: string, logprob: number, alternatives: [string, number][]];

export type Tone = "warn" | "bad";

export interface ReplyMeta
{
  tag?: string;
  tone?: Tone;
  stats?: string;
  model?: string;
  request?: string;
  tokens?: TokenInfo[];
  /** The model's <think> reasoning, kept for display only (never resent as history). */
  reasoning?: string;
  /** What the style check did, step by step (shown when hovering the style tag). */
  styleLog?: string[];
  /** Dev mode: the style-check record in IndexedDB, and your ✓/✗ label for this answer. */
  styleRunId?: number;
  styleLabel?: "good" | "bad";
}

export type ChatEntry =
  /** `unanswered`: the model couldn't reply (none loaded, or an error); the UI offers "Ask again". */
  | { role: "user"; content: string; unanswered?: boolean }
  | { role: "assistant"; content: string; meta?: ReplyMeta }
  | { role: "note"; content: string; danger?: boolean };

export interface AppState
{
  settings: Settings;
  notes: string[];
  chat: ChatEntry[];
  /** Everything sent from the input box (questions and /commands), oldest first, for ↑/↓. */
  inputHistory: string[];
}

/** A message in the format WebLLM's OpenAI-style API expects. */
export interface ChatMessage
{
  role: "system" | "user" | "assistant";
  content: string;
}

export type DeviceInfo =
  | { webgpu: false }
  | {
    webgpu: true;
    /** GPU supports 16-bit float shaders; required for q4f16 models. */
    f16: boolean;
    maxBufferMB: number;
    /** Software (CPU) WebGPU implementation: works, but very slow. */
    fallback: boolean;
    gpu: string;
    /** navigator.deviceMemory: Chromium only, rounded, capped at 8. */
    ramGB: number | undefined;
    cores: number | undefined;
    mobile: boolean;
  };
