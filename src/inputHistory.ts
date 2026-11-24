// Terminal-style input history: ↑ steps back through what was sent, ↓ steps forward, and
// stepping past the newest entry restores whatever was being typed. Pure; no DOM.

export const MAX_INPUT_HISTORY = 100;

/** Adds a sent message to the history (skipping an exact repeat of the last one) and caps its length. */
export function addToHistory(history: readonly string[], text: string): string[]
{
  const next = history.at(-1) === text ? [...history] : [...history, text];

  return next.slice(-MAX_INPUT_HISTORY);
}

export class HistoryCursor
{
  /** Position in the history while browsing; null when not browsing. */
  private index: number | null = null;
  private draft = "";

  constructor(private readonly entries: () => readonly string[])
  {}

  get browsing(): boolean
  {
    return this.index !== null;
  }

  /** ↑: returns the older entry to show, or null if there's nothing older. `current` is saved as the draft on the first step. */
  older(current: string): string | null
  {
    const entries = this.entries();

    if (entries.length === 0) return null;

    if (this.index === null)
    {
      this.draft = current;
      this.index = entries.length - 1;
    }
    else if (this.index > 0)
    {
      this.index--;
    }
    else
    {
      return null; // already at the oldest
    }

    return entries[this.index];
  }

  /** ↓: returns the newer entry, or the saved draft after the newest; null if not browsing. */
  newer(): string | null
  {
    if (this.index === null) return null;

    const entries = this.entries();

    if (this.index < entries.length - 1) return entries[++this.index];
    this.index = null;

    return this.draft;
  }

  /** Stop browsing (the user typed, or sent the message). */
  reset(): void
  {
    this.index = null;
    this.draft = "";
  }
}
