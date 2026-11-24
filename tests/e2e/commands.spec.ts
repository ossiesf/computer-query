import { expect, test } from "@playwright/test";
import { QWEN_F16, lastMessage, messages, send, setup, status } from "./helpers";

test("command menu: filter, complete, and run", async ({ page }) =>
{
  await setup(page);
  await page.goto("/");

  const input = page.locator("#input");
  const menu = page.locator("#cmdMenu li");

  await input.fill("/");
  await expect(menu).toHaveCount(6);
  await input.pressSequentially("re");
  await expect(menu).toHaveText([/\/remember/, /\/reset/]);

  await input.press("Enter"); // completes "/remember " and waits for text
  await expect(input).toHaveValue("/remember ");
  await input.pressSequentially("Studies biology");
  await input.press("Enter");
  await expect(lastMessage(page)).toHaveText("Note 1 stored: Studies biology");

  // "/forget " lists notes by number
  await input.fill("/forget ");
  await expect(menu).toHaveText([/\/forget 1\s*Studies biology/]);
  await input.press("Enter");
  await expect(lastMessage(page)).toContainText("Note 1 deleted");
});

test("unknown commands get a hint", async ({ page }) =>
{
  await setup(page);
  await page.goto("/");
  await send(page, "/xyz");
  await expect(lastMessage(page)).toContainText("Unknown command: /xyz. Type /help.");
});

test("/reset needs confirmation, can be cancelled, and wipes everything", async ({ page }) =>
{
  await setup(page, { cached: [QWEN_F16] });
  await page.goto("/");
  await expect(status(page)).toContainText("Model online");
  await send(page, "/remember Studies biology");

  await send(page, "/reset");
  await expect(lastMessage(page)).toContainText("WARNING — this permanently deletes");
  await expect(lastMessage(page)).toContainText("Qwen2.5 1.5B f16");
  await expect(lastMessage(page)).toHaveClass(/danger/);

  await send(page, "/notes"); // any other input cancels
  await expect(messages(page).nth(-2)).toHaveText("Reset cancelled. Nothing was deleted.");

  await send(page, "/reset confirm");
  await expect(lastMessage(page)).toContainText("No reset pending");

  await send(page, "/reset");
  await send(page, "/reset confirm");
  await expect(status(page)).toContainText("Reset complete");
  expect(await page.evaluate(() => localStorage.getItem("fake-webllm-cache"))).toBe("[]");
  expect(await page.evaluate(() => localStorage.getItem("computer-query.v1"))).toBeNull();

  // The page reloads fresh: no chat or notes, and a model loads again.
  await page.waitForEvent("load");
  await expect(messages(page)).toHaveCount(0);
  await expect(status(page)).toContainText("Model online", { timeout: 10_000 });
});
