import { expect, test } from "@playwright/test";
import { lastMessage, modelReady, send, setup } from "./helpers";

test("↑ and ↓ step through sent messages and restore the draft", async ({ page }) =>
{
  await setup(page);
  await page.goto("/");
  await modelReady(page);
  await send(page, "First question");
  await expect(lastMessage(page)).toContainText("style: ok");
  await send(page, "/notes");
  await expect(lastMessage(page)).toContainText("No notes stored.");

  const input = page.locator("#input");

  await input.click();
  await input.pressSequentially("half-typed");
  await input.press("ArrowUp");
  await expect(input).toHaveValue("/notes");
  await expect(page.locator("#cmdMenu")).toBeHidden(); // a recalled command doesn't open the menu
  await input.press("ArrowUp");
  await expect(input).toHaveValue("First question");
  await input.press("ArrowUp"); // nothing older: stays put
  await expect(input).toHaveValue("First question");
  await input.press("ArrowDown");
  await expect(input).toHaveValue("/notes");
  await input.press("ArrowDown");
  await expect(input).toHaveValue("half-typed");

  // The history survives a reload.
  await page.reload();
  await page.locator("#input").press("ArrowUp");
  await expect(page.locator("#input")).toHaveValue("/notes");
});

test("↑ moves the cursor normally inside a multi-line message", async ({ page }) =>
{
  await setup(page);
  await page.goto("/");
  await modelReady(page);
  await send(page, "Earlier question");
  await expect(lastMessage(page)).toContainText("style: ok");

  const input = page.locator("#input");

  await input.click();
  await input.pressSequentially("line one");
  await input.press("Shift+Enter");
  await input.pressSequentially("line two");
  await input.press("ArrowUp"); // cursor is on line two: moves up a line, no history
  await expect(input).toHaveValue("line one\nline two");
  await input.press("ArrowUp"); // now on the first line: recalls history
  await expect(input).toHaveValue("Earlier question");
});

test("with the command menu open, ↑/↓ move through the menu instead", async ({ page }) =>
{
  await setup(page);
  await page.goto("/");
  await modelReady(page);
  await send(page, "Earlier question");

  const input = page.locator("#input");

  await input.fill("/");
  await input.press("ArrowDown");
  await expect(page.locator('#cmdMenu li[aria-selected="true"]')).toContainText("/forget");
  await expect(input).toHaveValue("/");
});
