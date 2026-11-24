// Times each phase of a model load from WebLLM's progress messages. Pure; the clock is injectable for tests.

export type LoadPhase = "download" | "cacheToGpu" | "shaders" | "done";

export const PHASE_LABELS: Record<Exclude<LoadPhase, "done">, string> = {
  download: "download",
  cacheToGpu: "cache→GPU",
  shaders: "shaders",
};

/** WebLLM reports progress as text; the prefix identifies the phase. */
export function phaseOf(progressText: string): LoadPhase | null
{
  if (progressText.startsWith("Fetching param cache")) return "download";
  if (progressText.startsWith("Loading model from cache")) return "cacheToGpu";
  if (progressText.startsWith("Loading GPU shader modules")) return "shaders";
  if (progressText.startsWith("Finish loading")) return "done";

  return null;
}

export interface LoadTiming
{
  totalMs: number;
  firstProgressMs: number | null;
  downloadMs?: number;
  cacheToGpuMs?: number;
  shadersMs?: number;
  downloadedMB: number | null;
}

export interface LoadSnapshot extends LoadTiming
{
  /** The phase in progress right now. */
  current: LoadPhase | null;
}

export class LoadTimer
{
  private readonly startedAt: number;
  private readonly phaseStarts = new Map<LoadPhase, number>();
  private downloadedMB: number | null = null;

  constructor(private readonly now: () => number = () => performance.now())
  {
    this.startedAt = now();
  }

  onProgress(text: string): void
  {
    const phase = phaseOf(text);

    if (phase && !this.phaseStarts.has(phase)) this.phaseStarts.set(phase, this.now() - this.startedAt);

    const mb = text.match(/(\d+)MB fetched/);

    if (mb) this.downloadedMB = Number(mb[1]);
  }

  /** Each phase lasts until the next one starts (or until now). */
  snapshot(): LoadSnapshot
  {
    const totalMs = Math.round(this.now() - this.startedAt);
    const ordered = [...this.phaseStarts.entries()].sort((a, b) => a[1] - b[1]);
    const timing: LoadSnapshot = {
      totalMs,
      firstProgressMs: ordered.length ? Math.round(ordered[0][1]) : null,
      downloadedMB: this.downloadedMB,
      current: ordered.length ? ordered[ordered.length - 1][0] : null,
    };

    ordered.forEach(([phase, start], i) =>
    {
      if (phase === "done") return;

      const end = ordered[i + 1]?.[1] ?? totalMs;

      timing[`${phase}Ms`] = Math.round(end - start);
    });

    return timing;
  }

  finish(): LoadTiming
  {
    const { current: _current, ...timing } = this.snapshot();

    return timing;
  }
}
