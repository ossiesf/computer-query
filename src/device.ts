// Reads the hardware signals the browser exposes. No API reports GPU memory directly.
import type { DeviceInfo } from "./types";

// Non-standard browser properties.
interface NavigatorExtras
{
  deviceMemory?: number;
  userAgentData?: { mobile: boolean };
}

export async function detectDevice(): Promise<DeviceInfo>
{
  if (!navigator.gpu) return { webgpu: false };

  let adapter: GPUAdapter | null = null;

  try
  {
    adapter = await navigator.gpu.requestAdapter();
  }
  catch
  {
    // Treated the same as no adapter.
  }

  if (!adapter) return { webgpu: false };

  const nav = navigator as Navigator & NavigatorExtras;
  const info = adapter.info as GPUAdapterInfo & { isFallbackAdapter?: boolean };

  return {
    webgpu: true,
    f16: adapter.features.has("shader-f16"),
    maxBufferMB: Math.round(adapter.limits.maxBufferSize / 1_048_576),
    fallback: Boolean(info?.isFallbackAdapter),
    gpu: [info?.vendor, info?.architecture].filter(Boolean).join(" ") || "unknown",
    ramGB: nav.deviceMemory,
    cores: navigator.hardwareConcurrency,
    mobile: nav.userAgentData?.mobile ?? isMobileUserAgent(),
  };
}

function isMobileUserAgent(): boolean
{
  const ua = navigator.userAgent;
  // iPadOS reports a Mac user agent; touch support gives it away.
  const iPad = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;

  return /Android|iPhone|iPod|Mobile/i.test(ua) || iPad;
}

/** One-line summary for the dev strip and settings dialog. */
export function describeDevice(device: DeviceInfo): string
{
  if (!device.webgpu) return "no WebGPU";

  const ram =
    device.ramGB === undefined ? "not reported" : device.ramGB >= 8 ? "8+ GB (browser caps at 8)" : `${device.ramGB} GB`;

  return [
    `GPU ${device.gpu}${device.fallback ? " (software fallback)" : ""}`,
    `shader-f16 ${device.f16 ? "yes" : "no"}`,
    `max GPU buffer ${device.maxBufferMB} MB`,
    `RAM ${ram}`,
    `${device.cores ?? "?"} CPU threads`,
    device.mobile ? "mobile" : "desktop",
  ].join(" · ");
}
