import { expect, test } from "@playwright/test";
import { QWEN_F16, lastMessage, messages, modelReady, pickModel, send, setup, status } from "./helpers";

test("loads a model on open, even the first time, and answers a question", async ({ page }) =>
{
  await setup(page); // nothing downloaded yet
  await page.goto("/");
  await modelReady(page, "Qwen2.5-1.5B-Instruct (f16)");
  await expect(page.locator("#modelPicker")).toHaveValue("auto");

  await send(page, "What is photosynthesis?");

  await expect(lastMessage(page)).toContainText("Photosynthesis: plants convert light into sugar.");
  await expect(lastMessage(page)).toContainText("style: ok");
  await expect(lastMessage(page)).toContainText("prompt 120 tok");
});

test("the model fixes a reply that breaks the style rules", async ({ page }) =>
{
  await setup(page, { replies: ["I think plants make sugar."], verdicts: ["FAIL", "PASS"], rewrites: ["Plants make sugar."] });
  await page.goto("/");
  await modelReady(page);
  await send(page, "What do plants make?");

  await expect(lastMessage(page).locator(".body")).toHaveText("Plants make sugar.");

  const tag = lastMessage(page).locator(".meta span").first();

  await expect(tag).toHaveText("style: fixed by the model");
  await expect(tag).toHaveAttribute("title", /Model check: FAIL\.\nFix 1: model rewrote the answer\.\nModel check: PASS\./);
});

test("if no fix passes, the original answer is kept and labeled", async ({ page }) =>
{
  await setup(page, { replies: ["I think plants make sugar."], verdicts: ["FAIL", "FAIL", "FAIL"] });
  await page.goto("/");
  await modelReady(page);
  await send(page, "What do plants make?");

  await expect(lastMessage(page).locator(".body")).toHaveText("I think plants make sugar.");
  await expect(lastMessage(page)).toContainText("style: may not match (couldn't fix)");
});

test("answers relationship questions without calling the model", async ({ page }) =>
{
  await setup(page);
  await page.goto("/");
  await send(page, "How are you?");

  await expect(lastMessage(page)).toContainText("does not have feelings or relationships");
  await expect(lastMessage(page)).toContainText("model not called");
});

test("auto-loads a cached model on open and holds a query sent mid-load", async ({ page }) =>
{
  await setup(page, { cached: [QWEN_F16], phaseMs: 600 });
  await page.goto("/");

  await send(page, "What is photosynthesis?");
  await expect(lastMessage(page)).toContainText("Please wait — model loading");

  await expect(lastMessage(page)).toContainText("Photosynthesis:", { timeout: 10_000 });
  await expect(messages(page)).toHaveCount(2); // the wait note is removed
});

test("chat history survives a reload", async ({ page }) =>
{
  await setup(page, { cached: [QWEN_F16] });
  await page.goto("/");
  await expect(status(page)).toContainText("Model online");
  await send(page, "What is photosynthesis?");
  await expect(lastMessage(page)).toContainText("Photosynthesis:");

  await page.reload();
  await expect(messages(page)).toHaveCount(2);
});

test("picks q4f32 on a GPU without shader-f16, and explains missing WebGPU", async ({ page, context }) =>
{
  await setup(page, { gpu: { f16: false } });
  await page.goto("/");
  await modelReady(page, "Qwen2.5-1.5B-Instruct (f32)");

  const other = await context.newPage();

  await setup(other, { gpu: { none: true } });
  await other.goto("/");
  await expect(status(other)).toContainText("WebGPU unavailable");
});

test("picking a model from the menu loads it", async ({ page }) =>
{
  await setup(page);
  await page.goto("/");
  await modelReady(page, "Qwen2.5-1.5B-Instruct");
  await pickModel(page, "llama1");
  await modelReady(page, "Llama-3.2-1B-Instruct");
  await expect(page.locator("#modelPicker option:checked")).toContainText("Llama 3.2 1B");
  await expect(page.locator("#modelPicker option:checked")).toContainText("✓");
});

test("a question that couldn't be answered gets an Ask again button once a model loads", async ({ page }) =>
{
  await setup(page);
  await page.addInitScript(() => ((window as unknown as { __fakeLLM: object }).__fakeLLM = { failLoad: "Out of memory" }));
  await page.goto("/");
  await expect(status(page)).toContainText("Load failed", { timeout: 10_000 });

  await send(page, "What is photosynthesis?");
  await expect(lastMessage(page)).toContainText("Not answered: no model is loaded");

  const question = messages(page).nth(-2);

  await expect(question.locator(".ask-again")).toHaveCount(0); // no model yet, so no button

  // Loading starts working again; picking a model loads it, and the button appears.
  await page.evaluate(() => ((window as unknown as { __fakeLLM: object }).__fakeLLM = {}));
  await pickModel(page, "llama1");
  await modelReady(page, "Llama-3.2-1B-Instruct");
  await question.locator(".ask-again").click();

  await expect(lastMessage(page)).toContainText("Photosynthesis:");
  await expect(messages(page)).toHaveCount(2); // the question moved down and was answered; the note is gone
  await expect(page.locator(".ask-again")).toHaveCount(0);
});

test("an answer that copies the previous one is answered again without the chat history", async ({ page }) =>
{
  const loops = "Python:\n```python\nfor i in range(5):\n    print(i)\n```\nA loop iterating from 0 to 4, printing each number.";

  await setup(page, { replies: [loops, loops, "Weight loss: a sustained calorie deficit, from food tracking and daily walking."] });
  await page.goto("/");
  await modelReady(page);

  await send(page, "Show for loops in Python.");
  await expect(lastMessage(page)).toContainText("style: ok");

  await send(page, "I need to lose weight but I'm not sure where to start");
  await expect(lastMessage(page)).toContainText("Weight loss: a sustained calorie deficit");
  await expect(lastMessage(page)).toContainText("answered again (repeat)");
  await expect(lastMessage(page)).not.toContainText("range(5)");
});

test("by default the model gets only the chat: no system prompt, no reminder, no style check", async ({ page }) =>
{
  await setup(page, { settings: {} });
  await page.goto("/");
  await modelReady(page);
  await send(page, "How are you?");
  await expect(lastMessage(page)).toContainText("style: not checked");

  const sent = await page.evaluate(() =>
  {
    const reqs = (window as unknown as { __fakeLLMRequests: { stream?: boolean; messages: { role: string; content: string }[] }[] }).__fakeLLMRequests;

    return reqs.filter((r) => r.stream === true).at(-1)!.messages;
  });

  // "How are you?" reached the model (no canned reply), exactly as typed.
  expect(sent).toEqual([{ role: "user", content: "How are you?" }]);
});

test("shows animated dots while waiting for the first words of an answer", async ({ page }) =>
{
  await setup(page, { settings: {}, replies: ["Plants make food by photosynthesis."], firstTokenMs: 1500 });
  await page.goto("/");
  await modelReady(page);
  await send(page, "How do plants make food?");

  const waiting = lastMessage(page).getByRole("status", { name: "Waiting for the answer" });

  await expect(waiting).toBeVisible();
  await expect(lastMessage(page)).toContainText("photosynthesis");
  await expect(waiting).toHaveCount(0);
});

test("Stop sits inside the reply being written, and keeps what was written so far", async ({ page }) =>
{
  const long = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");

  await setup(page, { replies: [long], wordMs: 50 });
  await page.goto("/");
  await modelReady(page);

  // No Stop button anywhere until a reply is being written.
  await expect(page.getByRole("button", { name: /^Stop/ })).toHaveCount(0);

  await send(page, "Write a lot.");

  const reply = lastMessage(page);
  const stop = reply.getByRole("button", { name: "Stop this reply" });

  await expect(reply).toContainText("word3");
  await stop.click();

  // The partial answer stays, tagged as stopped; the style check is skipped; Send works again.
  await expect(reply).toContainText("stopped");
  await expect(reply).toContainText("word3");
  await expect(reply).not.toContainText("word59");
  await expect(reply.getByRole("button", { name: "Stop this reply" })).toHaveCount(0);
  await expect(page.locator("#sendButton")).toBeEnabled();
});
