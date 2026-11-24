// Model load records (dev mode only). Data never leaves the browser.
import type { DeviceInfo, Precision } from "../types";
import { devStore } from "./devDb";
import type { LoadTiming } from "./loadTimer";

export interface LoadRecord extends LoadTiming
{
  id?: number;
  ts: string;
  appVersion: string;
  trigger: "manual" | "auto";
  model: string;
  prec: Precision;
  contextWindow: number;
  /** True if the weights had to be downloaded; null if unknown. */
  cold: boolean | null;
  ok: boolean;
  error: string | null;
  gpu: string | null;
  f16: boolean | null;
  maxBufferMB: number | null;
  ramGB: number | null;
  cores: number | null;
  mobile: boolean | null;
  fallback: boolean | null;
  userAgent: string;
}

export function deviceFields(device: DeviceInfo)
{
  if (!device.webgpu)
  {
    return { gpu: null, f16: null, maxBufferMB: null, ramGB: null, cores: null, mobile: null, fallback: null };
  }

  return {
    gpu: device.gpu,
    f16: device.f16,
    maxBufferMB: device.maxBufferMB,
    ramGB: device.ramGB ?? null,
    cores: device.cores ?? null,
    mobile: device.mobile,
    fallback: device.fallback,
  };
}

export const loadLog = devStore<LoadRecord>("loads");

export const CSV_COLUMNS: (keyof LoadRecord)[] = [
  "id", "ts", "appVersion", "trigger", "model", "prec", "contextWindow", "cold", "ok", "error",
  "totalMs", "firstProgressMs", "downloadMs", "cacheToGpuMs", "shadersMs", "downloadedMB",
  "gpu", "f16", "maxBufferMB", "ramGB", "cores", "mobile", "fallback", "userAgent",
];

export function toCsv(records: LoadRecord[]): string
{
  const cell = (value: unknown) =>
  {
    if (value == null) return "";

    const text = String(value);

    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const rows = records.map((r) => CSV_COLUMNS.map((c) => cell(r[c])).join(","));

  return [CSV_COLUMNS.join(","), ...rows].join("\n");
}
