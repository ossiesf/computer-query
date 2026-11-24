// Dev-mode UI: the live status strip on the main screen, and the load-timing and style-check
// tables in Settings.
import { describeDevice } from "../device";
import { shortName } from "../models";
import type { DeviceInfo } from "../types";
import { byId, downloadFile, el, escapeHtml, seconds, today } from "../ui/dom";
import { loadLog, toCsv, type LoadRecord } from "./loadLog";
import { PHASE_LABELS, type LoadSnapshot, type LoadTiming } from "./loadTimer";
import { styleLog, summarizeStyleRuns, toJsonl, type StyleRunRecord, type StyleSummary } from "./styleLog";

export interface LiveLoad
{
  model: string;
  prec: string;
  cold: boolean | null;
  trigger: string;
  snapshot: () => LoadSnapshot;
}

export class DevView
{
  private readonly strip = byId("devStrip");
  private lastRecord: LoadRecord | null = null;
  private totalsLine = "";
  private styleLine = "";
  private device: DeviceInfo | null = null;
  private liveTimer: number | undefined;

  constructor(onStripClick: () => void)
  {
    byId("devBadge").hidden = false;
    byId("devSection").hidden = false;
    this.strip.hidden = false;
    this.strip.addEventListener("click", onStripClick);

    byId("devExportCsv").addEventListener("click", async () =>
      downloadFile(`computer-query-loads-${today()}.csv`, toCsv(await loadLog.all()), "text/csv"),
    );
    byId("devExportJson").addEventListener("click", async () =>
      downloadFile(`computer-query-loads-${today()}.json`, JSON.stringify(await loadLog.all(), null, 2), "application/json"),
    );
    byId("devClear").addEventListener("click", async () =>
    {
      await loadLog.clear();
      await this.refresh();
    });

    byId("devStyleExport").addEventListener("click", async () =>
      downloadFile(`computer-query-style-checks-${today()}.jsonl`, toJsonl(await styleLog.all()), "application/x-ndjson"),
    );
    byId("devStyleClear").addEventListener("click", async () =>
    {
      await styleLog.clear();
      await this.refreshStyle();
    });
  }

  /** Saves a style check and returns its id (so a ✓/✗ label can be attached later), or undefined on failure. */
  async recordStyleRun(record: StyleRunRecord): Promise<number | undefined>
  {
    try
    {
      const id = await styleLog.add(record);

      await this.refreshStyle();

      return id;
    }
    catch (e)
    {
      console.warn("Dev style record not saved", e);

      return undefined;
    }
  }

  /** Re-reads the style records and redraws their summary, table, and strip line. */
  async refreshStyle(): Promise<void>
  {
    let records: StyleRunRecord[];

    try
    {
      records = await styleLog.all();
    }
    catch
    {
      return;
    }

    const summary = summarizeStyleRuns(records);

    this.styleLine = records.length ? styleStripLine(summary) : "";
    byId("devStyleSummary").textContent = styleSummaryText(summary);
    renderStyleTable(byId<HTMLTableElement>("devStyleTable"), records);
    this.renderStrip();
  }

  get section(): HTMLElement
  {
    return byId("devSection");
  }

  setDevice(device: DeviceInfo): void
  {
    this.device = device;
    this.renderStrip();
  }

  /** Shows a load in progress, updating 5 times a second until `endLive` is called. */
  startLive(load: LiveLoad): void
  {
    this.endLive();

    const render = () => this.renderStrip(load);

    render();
    this.liveTimer = window.setInterval(render, 200);
  }

  endLive(): void
  {
    window.clearInterval(this.liveTimer);
    this.liveTimer = undefined;
  }

  async record(record: LoadRecord): Promise<void>
  {
    try
    {
      await loadLog.add(record);
    }
    catch (e)
    {
      console.warn("Dev load timing not saved", e);
    }

    console.table([record]);
    await this.refresh();
  }

  /** Re-reads the database and redraws the strip and table. */
  async refresh(): Promise<void>
  {
    let records: LoadRecord[];

    try
    {
      records = await loadLog.all();
    }
    catch (e)
    {
      byId("devSummary").textContent = `IndexedDB unavailable: ${e instanceof Error ? e.message : e}`;

      return;
    }

    this.lastRecord = records.at(-1) ?? null;
    this.totalsLine = totalsLine(records);
    this.renderStrip();
    this.renderTable(records);
    await this.refreshStyle();
  }

  private renderStrip(live?: LiveLoad): void
  {
    let html: string;

    if (live)
    {
      const t = live.snapshot();

      html =
        `<b>DEV</b> loading ${escapeHtml(shortName(live.model))} ${live.prec} · ${coldLabel(live.cold)} · ${live.trigger}\n` +
        `${phaseLine(t, t.current)} · elapsed <span class="live">${seconds(t.totalMs)}s</span>` +
        (t.downloadedMB ? ` · ${t.downloadedMB} MB fetched` : "");
    }
    else if (this.lastRecord)
    {
      const r = this.lastRecord;
      const result = r.ok ? "✓" : `<span class="bad">✗ ${escapeHtml(r.error ?? "")}</span>`;

      html =
        `<b>DEV</b> last load: ${escapeHtml(shortName(r.model))} ${r.prec} · ${coldLabel(r.cold)} · ${r.trigger} · ${result}\n` +
        `${phaseLine(r)} · total ${seconds(r.totalMs)}s` +
        (r.downloadedMB ? ` · ${r.downloadedMB} MB` : "");
    }
    else
    {
      html = "<b>DEV</b> no loads recorded yet";
    }

    const device = this.device ? describeDevice(this.device) : "checking…";
    const style = this.styleLine ? `\n${escapeHtml(this.styleLine)}` : "";

    this.strip.innerHTML = `${html}\n${escapeHtml(this.totalsLine)}${style}\ndevice: ${escapeHtml(device)}`;
  }

  private renderTable(records: LoadRecord[]): void
  {
    byId("devSummary").textContent = summaryByModel(records);

    const table = byId<HTMLTableElement>("devTable");

    table.textContent = "";

    const header = table.insertRow();

    for (const title of ["time", "model", "", "dl s", "cache→GPU s", "shaders s", "total s", "MB", "ok"])
    {
      header.append(el("th", { text: title }));
    }

    for (const r of records.slice(-25).reverse())
    {
      const row = table.insertRow();

      row.title = r.error ?? "";

      const cells = [
        r.ts.slice(5, 16).replace("T", " "),
        `${shortName(r.model)} ${r.prec}`,
        coldLabel(r.cold),
        seconds(r.downloadMs),
        seconds(r.cacheToGpuMs),
        seconds(r.shadersMs),
        seconds(r.totalMs),
        String(r.downloadedMB ?? ""),
      ];

      for (const text of cells) row.insertCell().textContent = text;

      const ok = row.insertCell();

      ok.textContent = r.ok ? "✓" : "✗";
      if (!r.ok) ok.className = "bad";
    }
  }
}

function coldLabel(cold: boolean | null): string
{
  return cold == null ? "?" : cold ? "cold" : "warm";
}

/** "download 1.5s · cache→GPU 0.1s · shaders 0.6s…" with the running phase highlighted. */
function phaseLine(t: LoadTiming, running?: string | null): string
{
  return (Object.keys(PHASE_LABELS) as (keyof typeof PHASE_LABELS)[])
    .map((phase) =>
    {
      const ms = t[`${phase}Ms`];
      const text = `${PHASE_LABELS[phase]} ${ms == null ? "—" : seconds(ms) + "s"}`;

      return phase === running ? `<span class="live">${text}…</span>` : text;
    })
    .join(" · ");
}

function median(values: number[]): number | null
{
  if (values.length === 0) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;

  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function totalsLine(records: LoadRecord[]): string
{
  const ok = records.filter((r) => r.ok);
  const medianFor = (cold: boolean) => median(ok.filter((r) => r.cold === cold).map((r) => r.totalMs));
  const fmt = (ms: number | null) => (ms == null ? "—" : `${seconds(ms)}s`);

  return (
    `recorded: ${records.length} loads (${records.length - ok.length} failed) · ` +
    `median cold ${fmt(medianFor(true))} · median warm ${fmt(medianFor(false))} · stored in IndexedDB`
  );
}

function summaryByModel(records: LoadRecord[]): string
{
  if (records.length === 0) return "No loads recorded yet.";

  const groups = new Map<string, number[]>();

  for (const r of records.filter((r) => r.ok))
  {
    const key = `${shortName(r.model)} ${coldLabel(r.cold)}`;

    groups.set(key, [...(groups.get(key) ?? []), r.totalMs]);
  }

  const parts = [...groups].map(([key, times]) => `${key} ${seconds(median(times))}s (n=${times.length})`);

  return `${records.length} loads recorded. Median total: ${parts.join(" · ") || "no successful loads"}`;
}

// ---------- Style-check summary ----------

const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : "—");
const ms = (x: number | null) => (x == null ? "—" : `${(x / 1000).toFixed(1)}s`);

function agreementText(a: StyleSummary["agreement"]["model"]): string
{
  if (!a?.total) return "no labeled answers yet";

  return `agreed ${a.agreed}/${a.total} · missed ${a.missed} · false alarms ${a.falseAlarms}`;
}

function styleStripLine(s: StyleSummary): string
{
  const o = s.outcomes;
  const agree = s.agreement.model?.total ? ` · check agreed with you ${s.agreement.model.agreed}/${s.agreement.model.total}` : "";

  return `style: ${s.runs} checks · ${pct(o.pass, s.runs)} ok · ${pct(o.fixed, s.runs)} fixed · ${pct(o["not-fixed"], s.runs)} not fixed${agree}`;
}

function styleSummaryText(s: StyleSummary): string
{
  if (s.runs === 0) return "No style checks recorded yet.";

  const o = s.outcomes;
  const lines = [
    `${s.runs} checks: ok on first try ${pct(o.pass, s.runs)} · fixed by the model ${pct(o.fixed, s.runs)} · ` +
      `couldn't fix ${pct(o["not-fixed"], s.runs)} · couldn't check ${pct(o.unsure + o.error, s.runs)}` +
      (o["fix-off"] ? ` · fixing off ${o["fix-off"]}` : "") + (o.unchecked ? ` · not checked ${o.unchecked}` : ""),
    `Average time: model check ${ms(s.avgCheckMs)} · each fix ${ms(s.avgFixMs)}`,
  ];
  const discarded = Object.entries(s.discarded);

  if (discarded.length) lines.push(`Fixes thrown away: ${discarded.map(([why, n]) => `${why} ×${n}`).join(", ")}`);
  lines.push(`Model check vs your ✓/✗: ${agreementText(s.agreement.model)}`);
  if (s.agreement.rules) lines.push(`Word rules vs your ✓/✗: ${agreementText(s.agreement.rules)}`);
  lines.push("Missed = the check passed an answer you marked ✗. False alarm = it failed one you marked ✓.");

  return lines.join("\n");
}

const OUTCOME_LABELS: Record<StyleRunRecord["outcome"], string> = {
  pass: "ok", fixed: "fixed", "not-fixed": "couldn't fix", "fix-off": "failed (fixing off)",
  unsure: "couldn't check", error: "error", unchecked: "not checked",
};

function renderStyleTable(table: HTMLTableElement, records: StyleRunRecord[]): void
{
  table.textContent = "";

  const header = table.insertRow();

  for (const title of ["time", "question", "result", "fixes", "check s", "fix s", "you"]) header.append(el("th", { text: title }));

  for (const r of records.slice(-25).reverse())
  {
    const sum = (kind: "check" | "fix") => r.steps.filter((s) => s.kind === kind).reduce((t, s) => t + s.ms, 0);
    const row = table.insertRow();

    row.title = r.steps.map((s) => s.note).join("\n");

    const cells = [
      r.ts.slice(5, 16).replace("T", " "),
      r.question.length > 40 ? `${r.question.slice(0, 39)}…` : r.question,
      OUTCOME_LABELS[r.outcome],
      String(r.steps.filter((s) => s.kind === "fix").length),
      seconds(sum("check")),
      seconds(sum("fix")),
      r.label === "good" ? "✓" : r.label === "bad" ? "✗" : "",
    ];

    for (const text of cells) row.insertCell().textContent = text;
  }
}
