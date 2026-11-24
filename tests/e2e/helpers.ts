import { expect, type Page } from "@playwright/test";
import { SETTINGS_VERSION, SHIP_COMPUTER_PROMPT, STORAGE_KEY } from "../../src/config";

export interface FakeGpu
{
  f16?: boolean;
  maxBufferMB?: number;
  ramGB?: number;
  mobile?: boolean;
  /** Pretend WebGPU is missing entirely. */
  none?: boolean;
}

export interface Setup
{
  gpu?: FakeGpu;
  /** Model IDs to treat as already downloaded. */
  cached?: string[];
  replies?: string[];
  verdicts?: string[];
  rewrites?: string[];
  phaseMs?: number;
  firstTokenMs?: number;
  wordMs?: number;
  /**
   * Saved settings to start with. Defaults to the ship's-computer prompt with the style check on,
   * so the style pipeline stays covered while it's off by default. Pass {} for the app's defaults.
   */
  settings?: Record<string, unknown>;
}

const SHIP_SETTINGS = { systemPrompt: SHIP_COMPUTER_PROMPT, styleCheck: "model", styleCanned: true, settingsVersion: SETTINGS_VERSION };

export const QWEN_F16 = "Qwen2.5-1.5B-Instruct-q4f16_1-MLC";

/** Fakes WebGPU and seeds the fake model before the app's scripts run. */
export async function setup(page: Page, options: Setup = {}): Promise<void>
{
  const seed = { storageKey: STORAGE_KEY, settings: options.settings ?? SHIP_SETTINGS };

  await page.addInitScript(({ o, storageKey, settings }) =>
  {
    // Seed only once per test, so reloads keep whatever the app saved.
    if (!sessionStorage.getItem("seeded"))
    {
      sessionStorage.setItem("seeded", "1");
      localStorage.setItem("fake-webllm-cache", JSON.stringify(o.cached ?? []));
      localStorage.setItem(storageKey, JSON.stringify({ settings }));
    }

    (window as unknown as { __fakeLLM: unknown }).__fakeLLM = {
      replies: o.replies, verdicts: o.verdicts, rewrites: o.rewrites, phaseMs: o.phaseMs, firstTokenMs: o.firstTokenMs, wordMs: o.wordMs,
    };

    const gpu = o.gpu ?? {};
    const adapter = {
      features: new Set(gpu.f16 === false ? [] : ["shader-f16"]),
      limits: { maxBufferSize: (gpu.maxBufferMB ?? 4096) * 1_048_576 },
      info: { vendor: "fake", architecture: "test" },
    };

    Object.defineProperty(navigator, "gpu", { value: gpu.none ? undefined : { requestAdapter: async () => adapter } });
    Object.defineProperty(navigator, "deviceMemory", { value: gpu.ramGB });
    Object.defineProperty(navigator, "userAgentData", { value: { mobile: gpu.mobile ?? false } });
  }, { o: options, ...seed });
}

export const status = (page: Page) => page.locator("#status");
export const messages = (page: Page) => page.locator("#log .msg");
export const lastMessage = (page: Page) => messages(page).last();

export async function send(page: Page, text: string): Promise<void>
{
  await page.locator("#input").fill(text);
  await page.locator("#input").press("Escape"); // close the command menu if it opened
  await page.locator("#sendButton").click();
}

/** Models load on their own when the page opens or a model is picked; this waits for it. */
export async function modelReady(page: Page, name = ""): Promise<void>
{
  await expect(status(page)).toContainText(`Model online: ${name}`, { timeout: 10_000 });
}

/** Picks a model from the header menu, which loads it. */
export async function pickModel(page: Page, value: string): Promise<void>
{
  await page.locator("#modelPicker").selectOption(value);
}
