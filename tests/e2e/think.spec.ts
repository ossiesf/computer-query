import { expect, test } from "@playwright/test";
import { lastMessage, modelReady, pickModel, send, setup } from "./helpers";

test("clicking Think with a model that can't reason switches to Qwen3 1.7B and loads it", async ({ page }) =>
{
  await setup(page);
  await page.goto("/");
  await modelReady(page, "Qwen2.5-1.5B-Instruct"); // Auto's pick here, which can't think

  const think = page.locator("#thinkButton");

  await expect(think).toHaveAttribute("title", /Click to switch to Qwen3 1.7B/);

  await think.click();
  await expect(think).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#modelPicker")).toHaveValue("qwen3_17b");
  await modelReady(page, "Qwen3-1.7B");
  await expect(page.locator("#thinkState")).toHaveText("on");
  await expect(think).toHaveAttribute("title", /Click to turn off/);
});

test("Think stays on but explains when the loaded model can't use it", async ({ page }) =>
{
  await setup(page);
  await page.goto("/");
  await page.locator("#thinkButton").click(); // switches to Qwen3 1.7B
  await modelReady(page, "Qwen3-1.7B");
  await pickModel(page, "qwen15");            // the user picks a model that can't reason
  await modelReady(page, "Qwen2.5-1.5B-Instruct");
  await expect(page.locator("#thinkState")).toHaveText("on");
  await expect(page.locator("#thinkButton")).toHaveAttribute("title", /Load a Qwen3 model to use Think/);
});

test("one click turns thinking on; reasoning is shown but kept out of the answer", async ({ page }) =>
{
  await setup(page);
  await page.goto("/");
  await pickModel(page, "qwen3_17b");
  await modelReady(page, "Qwen3-1.7B");

  const think = page.locator("#thinkButton");

  await think.click();
  await expect(think).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#thinkState")).toHaveText("on");

  await send(page, "How do plants make food?");

  const reply = lastMessage(page);

  await expect(reply.locator(".body")).toHaveText("Photosynthesis: plants convert light into sugar.");
  await expect(reply).toContainText("style: ok · thinking"); // "I think" in the reasoning doesn't fail the check
  await expect(reply.locator("details.reasoning summary")).toHaveText(/Reasoning \(\d+ words\)/);

  type Req = { stream?: boolean; extra_body?: unknown; max_tokens: number };

  const requests = await page.evaluate(() => (window as unknown as { __fakeLLMRequests: Req[] }).__fakeLLMRequests);
  const answer = requests.filter((r) => r.stream === true).at(-1);
  const styleCheck = requests.filter((r) => r.stream === false).at(-1);

  expect(answer?.extra_body).toEqual({ enable_thinking: true });
  expect(answer?.max_tokens).toBe(512 + 1536);
  expect(styleCheck?.extra_body).toEqual({ enable_thinking: false }); // the quick check never reasons

  // The toggle is remembered, and a second click turns it off.
  await page.reload();
  await expect(think).toHaveAttribute("aria-pressed", "true");
  await think.click();
  await expect(think).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#thinkState")).toHaveText("off");
});

test("the Think button keeps the same size when toggled", async ({ page }) =>
{
  await setup(page);
  await page.goto("/");
  await pickModel(page, "qwen3_17b");

  const think = page.locator("#thinkButton");
  const before = await think.boundingBox();

  await think.click();
  await expect(page.locator("#thinkState")).toHaveText("on");

  const after = await think.boundingBox();

  expect(after?.width).toBe(before?.width);
  expect(after?.height).toBe(before?.height);
  await expect(think.locator(".think-label")).toHaveText("Think");
  await expect(think.locator("#thinkState")).toHaveText("on"); // the state label sits inside the button
});

test("the notice is centered under the input box", async ({ page }) =>
{
  await setup(page);
  await page.goto("/");

  const input = await page.locator("#input").boundingBox();
  const notice = await page.locator(".notice").boundingBox();
  const center = (b: { x: number; width: number }) => b.x + b.width / 2;

  expect(Math.abs(center(notice!) - center(input!))).toBeLessThan(1);
  expect(notice!.y).toBeGreaterThan(input!.y + input!.height);
  await expect(page.locator(".notice")).toHaveText(
    "Preview. Models make mistakes, so verify important facts. All your data stays on your device.",
  );
});
