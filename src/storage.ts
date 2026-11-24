// Saves and loads settings, notes, and chat in localStorage.
import { DEFAULT_SETTINGS, MAX_SAVED_CHAT, MODEL_FAMILIES, PREVIOUS_DEFAULT_PROMPTS, SHIP_COMPUTER_PROMPT, STORAGE_KEY } from "./config";
import { MAX_INPUT_HISTORY, addToHistory } from "./inputHistory";
import { isFamilyKey } from "./models";
import type { AppState, ChatEntry, Settings } from "./types";

export function freshState(): AppState
{
  return { settings: { ...DEFAULT_SETTINGS }, notes: [], chat: [], inputHistory: [] };
}

export function loadState(): AppState
{
  try
  {
    const raw = localStorage.getItem(STORAGE_KEY);

    if (raw) return parseState(JSON.parse(raw));
  }
  catch
  {
    // Unreadable or blocked storage: start fresh.
  }

  return freshState();
}

/** Accepts saved or imported data and fills in anything missing. */
export function parseState(data: unknown): AppState
{
  const obj = (data ?? {}) as Partial<AppState> & { settings?: Record<string, unknown> };
  const chat = Array.isArray(obj.chat) ? obj.chat.map(migrateChatEntry) : [];

  return {
    settings: migrateSettings(obj.settings ?? {}),
    notes: strings(obj.notes),
    chat,
    // Saves from before v0.7 had no input history: start it from the questions in the chat.
    inputHistory: Array.isArray(obj.inputHistory)
      ? strings(obj.inputHistory).slice(-MAX_INPUT_HISTORY)
      : chat.reduce<string[]>((h, e) => (e.role === "user" ? addToHistory(h, e.content) : h), []),
  };
}

function strings(value: unknown): string[]
{
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** v0.4 stored message styling as `cls`; now `tone` (replies) and `danger` (notes). */
function migrateChatEntry(entry: ChatEntry): ChatEntry
{
  const legacy = entry as ChatEntry & { cls?: string; meta?: { cls?: string } };

  if (legacy.role === "note" && legacy.cls === "danger") return { role: "note", content: legacy.content, danger: true };

  if (legacy.role === "assistant" && legacy.meta?.cls)
  {
    const { cls, ...meta } = legacy.meta;

    return { ...legacy, meta: { ...meta, ...(cls === "warn" || cls === "bad" ? { tone: cls } : {}) } };
  }

  return entry;
}

/** Returns an error message if saving failed (e.g. storage full or blocked). */
export function saveState(state: AppState): string | null
{
  try
  {
    state.chat = state.chat.slice(-MAX_SAVED_CHAT);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));

    return null;
  }
  catch (e)
  {
    return e instanceof Error ? e.message : String(e);
  }
}

export function clearSavedState(): void
{
  try
  {
    localStorage.removeItem(STORAGE_KEY);
  }
  catch
  {
    // Nothing to clear.
  }
}

/** Upgrades settings saved by older versions. */
export function migrateSettings(saved: Record<string, unknown>): Settings
{
  const s: Record<string, unknown> = { ...saved };

  // v0.2: model was a full WebLLM ID; now a family key or "auto".
  if (s.model !== undefined && s.model !== "auto" && !isFamilyKey(s.model))
  {
    s.model = MODEL_FAMILIES.find((f) => String(s.model).startsWith(f.base))?.key ?? "auto";
  }

  // v0.4: "voice" settings were renamed to "style"; useMemory to useNotes. (Some of these names
  // were replaced again in v0.6, below.)
  const renamed: Record<string, string> = {
    vCanned: "styleCanned",
    vCheck: "styleCheck",
    vRegen: "styleRegenerate",
    vRewrite: "styleRewrite",
    useMemory: "useNotes",
  };

  for (const [oldKey, newKey] of Object.entries(renamed))
  {
    if (oldKey in s)
    {
      s[newKey] ??= s[oldKey];
      delete s[oldKey];
    }
  }

  // v0.6: the style check became model-based. The on/off check became a mode, and the
  // regenerate/rewrite steps became one "fix with the model" step.
  if (typeof s.styleCheck === "boolean") s.styleCheck = s.styleCheck ? "model" : "off";

  if ("styleRegenerate" in s || "styleRewrite" in s)
  {
    s.styleFix ??= Boolean(s.styleRegenerate || s.styleRewrite);
    delete s.styleRegenerate;
    delete s.styleRewrite;
  }

  // An unedited old ship's-computer prompt gets the current one; an edited prompt is kept as written.
  if (typeof s.systemPrompt === "string" && PREVIOUS_DEFAULT_PROMPTS.includes(s.systemPrompt))
  {
    s.systemPrompt = SHIP_COMPUTER_PROMPT;
  }

  // Settings version 2: the ship's-computer prompt and its style tools are off by default.
  // Settings still on the unedited prompt follow the new default; an edited prompt is left alone.
  if (typeof s.settingsVersion !== "number" || s.settingsVersion < 2)
  {
    if (s.systemPrompt === undefined || s.systemPrompt === SHIP_COMPUTER_PROMPT)
    {
      s.systemPrompt = "";
      s.styleCheck = "off";
      s.styleCanned = false;
    }

    s.settingsVersion = 2;
  }

  return { ...DEFAULT_SETTINGS, ...(s as Partial<Settings>) };
}
