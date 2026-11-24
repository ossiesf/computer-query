import { expect, test } from "@playwright/test";
import { lastMessage, modelReady, pickModel, send, setup, status } from "./helpers";

test("settings open as a modal and close with Esc, the backdrop, or the button", async ({ page }) =>
{
  await setup(page);
  await page.goto("/");

  const dialog = page.locator("dialog#settings");

  await page.locator("#settingsButton").click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.locator("#input")).toBeFocused();

  await page.locator("#settingsButton").click();
  await page.mouse.click(5, 300); // backdrop
  await expect(dialog).toBeHidden();

  await page.locator("#settingsButton").click();
  await page.locator("#closeSettings").click();
  await expect(dialog).toBeHidden();
});

test("settings persist across reloads", async ({ page }) =>
{
  await setup(page);
  await page.goto("/");
  await page.locator("#settingsButton").click();
  await page.locator("#slider-temperature").fill("1.2");
  await page.locator("#styleFix").uncheck();
  await page.locator("#styleCheck").selectOption("rules");
  await page.reload();

  await page.locator("#settingsButton").click();
  await expect(page.locator("#slider-temperature-value")).toHaveText("1.2");
  await expect(page.locator("#styleFix")).not.toBeChecked();
  await expect(page.locator("#styleCheck")).toHaveValue("rules");
});

test("dev mode records load timings and shows them live", async ({ page }) =>
{
  await setup(page, { phaseMs: 50 });
  await page.goto("/?dev=1");

  const strip = page.locator("#devStrip");

  await expect(page.locator("#devBadge")).toBeVisible();
  await expect(strip).toContainText("device: GPU fake test");

  // The page loads a model on open: a first download is "cold".
  await expect(strip).toContainText("loading Qwen2.5-1.5B-Instruct f16 · cold · auto");
  await expect(strip).toContainText("last load: Qwen2.5-1.5B-Instruct f16 · cold · auto · ✓", { timeout: 10_000 });
  await expect(strip).toContainText("900 MB");
  await expect(status(page)).toContainText("(cold)");

  // Picking a model records a "manual" load.
  await pickModel(page, "llama1");
  await expect(strip).toContainText("last load: Llama-3.2-1B-Instruct f16 · cold · manual · ✓", { timeout: 10_000 });

  // Dev mode persists without the URL flag; a downloaded model loads "warm".
  await page.goto("/");
  await expect(strip).toContainText("Llama-3.2-1B-Instruct f16 · warm · auto", { timeout: 10_000 });
  await expect(strip).toContainText("recorded: 3 loads (0 failed)");

  await strip.click();
  await expect(page.locator("#devTable tr")).toHaveCount(4); // header + 3 loads

  await page.goto("/?dev=0");
  await expect(strip).toBeHidden();
});

test("a failed load in Auto mode automatically tries the next smaller model", async ({ page }) =>
{
  await setup(page, { gpu: { ramGB: 4 } }); // Auto picks Llama 3.2 1B here
  // The first load fails; after that, loading works.
  await page.addInitScript(() =>
  {
    (window as unknown as { __fakeLLM: object }).__fakeLLM = { failLoad: "Out of memory", failLoadTimes: 1 };
  });
  await page.goto("/");
  await modelReady(page, "SmolLM2-360M-Instruct");
  await expect(status(page)).toContainText("Llama 3.2 1B didn't fit in GPU memory, so Auto switched to this smaller model");
  await expect(page.locator("#modelPicker option:checked")).toContainText("Auto: SmolLM2 360M");
});

test("changing precision or context window reloads the model", async ({ page }) =>
{
  await setup(page);
  await page.goto("/");
  await modelReady(page, "Qwen2.5-1.5B-Instruct (f16) · context 4096");
  await page.locator("#settingsButton").click();
  await page.locator("#contextWindow").selectOption("2048");
  await modelReady(page, "Qwen2.5-1.5B-Instruct (f16) · context 2048");
  await page.locator("#precision").selectOption("f32");
  await modelReady(page, "Qwen2.5-1.5B-Instruct (f32)");
});

test("dev mode records style checks, and ✓/✗ labels measure the check", async ({ page }) =>
{
  await setup(page, { replies: ["I think plants make sugar.", "Water is wet."], verdicts: ["FAIL", "PASS", "PASS"], rewrites: ["Plants make sugar."] });
  await page.goto("/?dev=1");
  await modelReady(page);

  await send(page, "What do plants make?");
  await expect(lastMessage(page)).toContainText("style: fixed by the model");
  await send(page, "Is water wet?");
  await expect(lastMessage(page)).toContainText("style: ok");

  const strip = page.locator("#devStrip");

  await expect(strip).toContainText("style: 2 checks · 50% ok · 50% fixed · 0% not fixed");

  // Label: the fixed answer is in style (✓); the second one we call out of style (✗) → the check missed it.
  const replies = page.locator("#log .msg.assistant");

  await replies.nth(0).getByRole("button", { name: "In style", exact: true }).click();
  await replies.nth(1).getByRole("button", { name: "Not in style" }).click();
  await expect(strip).toContainText("check agreed with you 1/2");
  await expect(replies.nth(1).getByRole("button", { name: "Not in style" })).toHaveAttribute("aria-pressed", "true");

  await strip.click();
  await expect(page.locator("#devStyleSummary")).toContainText("Model check vs your ✓/✗: agreed 1/2 · missed 1 · false alarms 0");
  await expect(page.locator("#devStyleTable tr")).toHaveCount(3); // header + 2 checks

  // Labels survive a reload; clicking the same label again clears it.
  await page.goto("/");
  await modelReady(page);
  await page.locator("#log .msg.assistant").nth(1).getByRole("button", { name: "Not in style" }).click();
  await expect(strip).toContainText("check agreed with you 1/1");
});

test("outside dev mode there are no label buttons", async ({ page }) =>
{
  await setup(page);
  await page.goto("/");
  await modelReady(page);
  await send(page, "What is photosynthesis?");
  await expect(lastMessage(page)).toContainText("style: ok");
  await expect(page.locator(".label-row")).toHaveCount(0);
});
