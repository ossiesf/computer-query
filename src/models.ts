// Model selection: which model and precision to load for a device. Pure functions, no browser APIs.
import { MODEL_FAMILIES } from "./config";
import type { DeviceInfo, FamilyKey, ModelFamily, Precision, Settings } from "./types";

export function familyByKey(key: FamilyKey): ModelFamily
{
  const family = MODEL_FAMILIES.find((f) => f.key === key);

  if (!family) throw new Error(`Unknown model family: ${key}`);

  return family;
}

export function isFamilyKey(value: unknown): value is FamilyKey
{
  return MODEL_FAMILIES.some((f) => f.key === value);
}

/** Full WebLLM model ID, e.g. "Qwen2.5-1.5B-Instruct-q4f16_1-MLC". */
export function modelId(family: ModelFamily, precision: Precision): string
{
  return `${family.base}-q4${precision}_1-MLC`;
}

/** "Qwen2.5-1.5B-Instruct-q4f16_1-MLC" → "Qwen2.5-1.5B-Instruct" */
export function shortName(id: string): string
{
  return id.replace(/-q4f(16|32)_1-MLC$/, "");
}

/** The family a full model ID belongs to, e.g. "Qwen3-4B-q4f16_1-MLC" → Qwen3 4B. */
export function familyForModelId(id: string): ModelFamily | null
{
  return MODEL_FAMILIES.find((f) => id.startsWith(`${f.base}-q4`)) ?? null;
}

/** The next smaller family, or null if this is already the smallest. */
export function smallerFamily(key: FamilyKey): ModelFamily | null
{
  const index = MODEL_FAMILIES.findIndex((f) => f.key === key);

  return MODEL_FAMILIES[index + 1] ?? null;
}

export interface Recommendation
{
  family: ModelFamily;
  precision: Precision;
  reason: string;
}

/**
 * Picks a model from the signals browsers expose. Browsers do not report GPU memory,
 * so this is a heuristic; `autoCap` lowers the ceiling after a load has failed.
 */
export function recommend(device: DeviceInfo, autoCap: FamilyKey | null = null): Recommendation
{
  if (!device.webgpu)
  {
    return { family: familyByKey("smol360"), precision: "f32", reason: "WebGPU unavailable" };
  }

  let key: FamilyKey = "qwen15";
  let reason = "desktop-class device";

  if (device.fallback)
  {
    key = "smol360";
    reason = "GPU is a software fallback (very slow)";
  }
  else if (device.mobile)
  {
    key = (device.ramGB ?? 0) >= 8 ? "llama1" : "smol360";
    reason = "phone/tablet (tight per-tab memory limits)";
  }
  else if (device.ramGB !== undefined && device.ramGB <= 2)
  {
    key = "smol360";
    reason = `browser reports ${device.ramGB} GB RAM`;
  }
  else if (device.ramGB !== undefined && device.ramGB <= 4)
  {
    key = "llama1";
    reason = `browser reports ${device.ramGB} GB RAM`;
  }
  else if (device.maxBufferMB < 1024)
  {
    key = "llama1";
    reason = `GPU max buffer only ${device.maxBufferMB} MB`;
  }

  if (autoCap && isLarger(key, autoCap))
  {
    key = autoCap;
    reason += `; capped at ${familyByKey(autoCap).name} after an earlier failed load`;
  }

  const precision: Precision = device.f16 ? "f16" : "f32";

  if (!device.f16) reason += "; no shader-f16, so q4f32";

  return { family: familyByKey(key), precision, reason };
}

/** True if family `a` is larger than family `b` (earlier in MODEL_FAMILIES). */
function isLarger(a: FamilyKey, b: FamilyKey): boolean
{
  const indexOf = (k: FamilyKey) => MODEL_FAMILIES.findIndex((f) => f.key === k);

  return indexOf(a) < indexOf(b);
}

export interface ResolvedModel
{
  family: ModelFamily;
  precision: Precision;
  id: string;
  recommendation: Recommendation;
}

/** Applies the user's settings on top of the device recommendation. */
export function resolveModel(settings: Settings, device: DeviceInfo): ResolvedModel
{
  const recommendation = recommend(device, settings.autoCap);
  const family = settings.model === "auto" ? recommendation.family : familyByKey(settings.model);
  const precision = settings.precision === "auto" ? recommendation.precision : settings.precision;

  return { family, precision, id: modelId(family, precision), recommendation };
}
