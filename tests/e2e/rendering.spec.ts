import { expect, test } from "@playwright/test";
import { lastMessage, modelReady, send, setup } from "./helpers";

const ANSWER =
  "A for loop repeats code a set number of times.\n```python\nfor i in range(5):\n    print(i)\n```\n" +
  "Output: 0 to 4. Use `range(n)` to set the count.";

test("answers render code blocks and inline code, with copy buttons", async ({ page, context }) =>
{
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await setup(page, { replies: [ANSWER] });
  await page.goto("/");
  await modelReady(page);
  await send(page, "Show a for loop in Python.");

  const reply = lastMessage(page);

  await expect(reply.locator(".code-block pre code")).toHaveText("for i in range(5):\n    print(i)");
  await expect(reply.locator(".code-head")).toContainText("python");
  await expect(reply.locator(".inline-code")).toHaveText("range(n)");
  await expect(reply.locator(".body")).not.toContainText("```"); // no raw fences

  // Copy just the code block.
  // The button is an icon; its accessible name says what it copies, then confirms.
  const copyCode = reply.locator(".code-head .copy-btn");

  await expect(copyCode).toHaveAccessibleName("Copy python");
  await expect(copyCode.locator("svg")).toBeVisible();
  await expect(copyCode).toHaveText(""); // no "Copy" word, just the icon
  await copyCode.click();
  await expect(copyCode).toHaveAccessibleName("Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("for i in range(5):\n    print(i)");

  // Copy the whole answer (as written, with markdown).
  await reply.getByRole("button", { name: "Copy answer" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(ANSWER);
});

test("HTML in an answer is shown as text, never run", async ({ page }) =>
{
  await setup(page, { replies: ['Example tag: <img src=x onerror="window.__pwned=1">'] });
  await page.goto("/");
  await modelReady(page);
  await send(page, "Show an img tag.");
  await expect(lastMessage(page).locator(".body")).toContainText('<img src=x onerror="window.__pwned=1">');
  expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
});

test("each request reminds the model to narrate around code", async ({ page }) =>
{
  await setup(page);
  await page.goto("/");
  await modelReady(page);
  await send(page, "Show a loop.");
  await expect(lastMessage(page)).toContainText("style: ok");

  const lastUser = await page.evaluate(() =>
  {
    const reqs = (window as unknown as { __fakeLLMRequests: { stream?: boolean; messages: { content: string }[] }[] }).__fakeLLMRequests;

    return reqs.filter((r) => r.stream === true).at(-1)!.messages.at(-1)!.content;
  });

  expect(lastUser).toMatch(/^Show a loop\.\n\n\(Style: impersonal.*one plain sentence before each code block.*not labels/s);
});

test("markdown shows as formatting: headings, bold, lists, rules, and whole code blocks", async ({ page }) =>
{
  const answer = [
    "Training a digit classifier. Code goes between ``` fences.",
    "",
    "---",
    "",
    "### **7. Make Predictions**",
    "Use the **trained** model to predict *new* data:",
    "",
    "1. Pick an image",
    "2. Call `model.predict`",
    "",
    "```python",
    "# Predict on a single image",
    "image = x_test[0].reshape(1, 28, 28)",
    "print(\"Predicted digit:\", model.predict(image).argmax())",
    "```",
  ].join("\n");

  await setup(page, { settings: {}, replies: [answer] });
  await page.goto("/");
  await modelReady(page);
  await send(page, "How do I predict a digit?");

  const body = lastMessage(page).locator(".body");

  // Formatting, not markdown symbols.
  await expect(body.locator("h4 strong")).toHaveText("7. Make Predictions");
  await expect(body.locator("p strong")).toHaveText("trained");
  await expect(body.locator("p em")).toHaveText("new");
  await expect(body.locator("ol > li")).toHaveCount(2);
  await expect(body.locator("hr")).toHaveCount(1);
  await expect(body).not.toContainText("**");
  await expect(body).not.toContainText("###");

  // The whole code block stays in one box, comment line included.
  await expect(body.locator(".code-block")).toHaveCount(1);
  await expect(body.locator(".code-block code")).toHaveText(/^# Predict on a single image\nimage = .*argmax\(\)\)$/s);
});
