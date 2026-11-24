import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../../src/config";
import { recommend, resolveModel } from "../../src/models";
import type { DeviceInfo } from "../../src/types";

const desktop: DeviceInfo = {
  webgpu: true, f16: true, maxBufferMB: 4096, fallback: false, gpu: "apple", ramGB: undefined, cores: 10, mobile: false,
};

const pick = (device: DeviceInfo, cap: Parameters<typeof recommend>[1] = null) =>
{
  const r = recommend(device, cap);

  return `${r.family.key} ${r.precision}`;
};

describe("recommend", () =>
{
  it("desktop (incl. Safari, which reports no RAM) → largest model", () =>
  {
    expect(pick(desktop)).toBe("qwen15 f16");
  });

  it("4 GB RAM → mid model", () =>
  {
    expect(pick({ ...desktop, ramGB: 4 })).toBe("llama1 f16");
  });

  it("small GPU buffer → mid model", () =>
  {
    expect(pick({ ...desktop, maxBufferMB: 512 })).toBe("llama1 f16");
  });

  it("phone → smallest model, unless it reports 8 GB", () =>
  {
    expect(pick({ ...desktop, mobile: true, ramGB: 4 })).toBe("smol360 f16");
    expect(pick({ ...desktop, mobile: true, ramGB: 8 })).toBe("llama1 f16");
  });

  it("software GPU → smallest model", () =>
  {
    expect(pick({ ...desktop, fallback: true })).toBe("smol360 f16");
  });

  it("no shader-f16 → q4f32 build of the same size", () =>
  {
    expect(pick({ ...desktop, f16: false })).toBe("qwen15 f32");
  });

  it("respects the cap set after a failed load", () =>
  {
    expect(pick(desktop, "smol360")).toBe("smol360 f16");
    expect(pick({ ...desktop, mobile: true }, "qwen15")).toBe("smol360 f16"); // cap never raises
  });
});

describe("resolveModel", () =>
{
  it("uses the recommendation in Auto mode", () =>
  {
    expect(resolveModel(DEFAULT_SETTINGS, desktop).id).toBe("Qwen2.5-1.5B-Instruct-q4f16_1-MLC");
  });

  it("manual choices override Auto", () =>
  {
    const settings = { ...DEFAULT_SETTINGS, model: "llama1" as const, precision: "f32" as const };

    expect(resolveModel(settings, desktop).id).toBe("Llama-3.2-1B-Instruct-q4f32_1-MLC");
  });
});
