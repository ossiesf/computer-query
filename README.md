# Computer Query

**Live preview: https://ossiesf.github.io/computer-query/** (desktop Chrome, Edge, or Safari 26+)

A free AI assistant for learning that runs entirely in the browser. There are no servers, no accounts, and no data collection: the model runs on your own GPU through [WebLLM](https://github.com/mlc-ai/web-llm) and WebGPU, and nothing you type leaves your device. The first visit downloads the model (hundreds of MB); after that it loads from the browser's cache.

- **See how sampling works:** settings for temperature, top-p and more, with notes on what each does to the answer.
- **Pick a model** sized for your device; it falls back to a smaller one if loading fails.
- **Think mode** (Qwen3) shows the model's reasoning before the answer.

It's a preview: small models make mistakes, and it isn't built for classroom use yet. Next up: an eval page for comparing models.

## Quick start

Needs Node.js 20+ (`brew install node` on macOS).

```bash
bash scripts/setup.sh          # once; add --with-tests to also install the test browser
npm start                      # dev server at http://localhost:5173, opens your browser
```

Open in a current Chrome, Edge, or Safari 26+. Add `?dev=1` to the URL for dev mode (load timings, device readout); `?dev=0` turns it off.

No Docker: the site is static files, and the model runs on the visitor's GPU inside their browser, so there is no server to containerize. `npm run build` produces `dist/`, which any static host (GitHub Pages) can serve.

## Scripts

| Command | What it does |
|---|---|
| `npm start` | Dev server with hot reload; opens the browser |
| `npm run dev` | Same, without opening the browser |
| `npm run build` | Type-check, then build the static site into `dist/` |
| `npm run preview` | Serve the built `dist/` locally |
| `npm run typecheck` | `tsc` over app, tests, and config |
| `npm run lint` | Code style check (ESLint); `npm run lint:fix` applies it |
| `npm test` | Unit tests (Vitest) |
| `npm run test:e2e` | Browser tests (Playwright) against a fake model; no GPU needed |
| `npm run check` | All of the above checks |

First time running e2e tests: `npx playwright install chromium`.

## Project layout

```
src/
  main.ts              Entry point: detect device, start the app
  app.ts               Connects state, model, and UI; handles input and commands
  config.ts            Models, defaults, system prompt, slider definitions
  types.ts             Shared types

  # Pure logic: no browser APIs, fully unit-tested
  style.ts             Style rules: first-person/emotion check, canned reply, rewrite
  respond.ts           Reply pipeline: generate → repeat guard → check → rewrite
  repeat.ts            Spots an answer that copies the previous one onto a new question
  conversation.ts      Builds the messages and sampling parameters sent to the model
  thinking.ts          Splits a reasoning model's <think> block from its answer
  markdown.ts          Turns answers into blocks and inline pieces via marked's parser (data, never HTML)
  commands.ts          Slash commands: parsing and autocomplete suggestions
  inputHistory.ts      ↑/↓ through previously sent messages (terminal-style)
  models.ts            Which model/precision to use for a device

  # Browser and library wrappers
  engine.ts            WebLLM: load, generate, cache (lazy-loaded, ~5 MB)
  device.ts            Reads WebGPU and navigator hardware signals
  storage.ts           localStorage save/load, plus migrations from older versions

  ui/                  One class per part of the screen
    chatView.ts        Chat log, token-probability view
    richText.ts        Renders parsed markdown as DOM nodes (text only via textContent)
    clipboard.ts       Copy buttons, with a fallback where the Clipboard API is blocked
    composer.ts        Input box: Enter to send, ↑/↓ history, slash-command menu
    settingsDialog.ts  Settings modal
    thinkToggle.ts     Think button (step-by-step reasoning on Qwen3 models)
    dom.ts             Small DOM helpers

  dev/                 Dev mode only (?dev=1)
    devMode.ts         URL flag
    loadTimer.ts       Times each model-load phase
    loadLog.ts         IndexedDB store + CSV export
    devView.ts         Live status strip and timing table

tests/
  unit/                Vitest tests for the pure modules
  e2e/                 Playwright tests for user flows
  fixtures/webllm-fake.ts   Stand-in for WebLLM, swapped in by `vite --mode e2e`

eslint.config.js       Code style: Allman braces, blank lines between steps (see CLAUDE.md)
eslint-rules/          Local lint rule: Allman braces for interfaces and enums
```

**Rule of thumb:** decisions go in pure modules (easy to test), side effects go in wrappers (easy to swap), and `app.ts` only wires them together.

## How the style rules are enforced

**Currently off by default.** The model gets no system prompt, only the chat, and the canned reply and style check are off. To turn the style back on: Settings → **Use ship's-computer prompt**, then set the style check to "Model". The repeat guard (3) always runs.

1. **System prompt** with rules and examples (`config.ts`).
2. **Canned reply** for relationship questions ("how are you?"): the model is never called.
3. **Repeat guard** (`repeat.ts`): small models sometimes copy their previous answer onto a new question (Qwen3 1.7B answered a weight-loss question with the earlier for-loop answer). If an answer is at least 90% the same as the last one (word-pair overlap) and the question changed, it is answered again without the chat history and tagged "answered again (repeat)". Short replies and a repeated question are exempt. No model call is needed to detect it.
4. **Check** each answer (`respond.ts`). By default the loaded model judges it with a one-word PASS/FAIL request (temperature 0, no thinking). It is told that quotes, word-usage examples, and code are fine, which word lists can't handle. A word-rules mode (`style.ts`) is available for comparison.
5. **Fix**: on FAIL, the model rewrites the answer, up to 2 tries, each one re-checked. Code blocks are swapped for placeholders first, so a rewrite can never change code; a rewrite that drops a code block or most of the answer is discarded.
6. **Fail gracefully**: if no fix passes, or the check errors or replies with something other than PASS/FAIL, the original answer is shown with a "may not match" or "couldn't check" tag. Hovering the tag lists each step.

Rewrites get help to succeed: the word rules name the specific problem words, two before/after examples show the target style, and a second try sends back the failed rewrite (at a slightly higher temperature) so it isn't a repeat. A rewrite that loses a number from the original is discarded.

A 1–2B model is a noisy judge, so it's measured: in dev mode (`?dev=1`) every check is recorded in IndexedDB (verdicts, rewrites, timings), and ✓/✗ buttons under each reply label whether the shown answer is in style. **Settings → Dev: style checks** shows how often the check agreed with your labels, how many violations it missed, and how many false alarms it raised, and exports everything as JSONL. Each layer can be switched off in Settings to see how the raw model behaves.

## Privacy

Settings, notes, and chat live in `localStorage`; model weights in the browser's Cache Storage; dev timings in IndexedDB. Nothing is sent anywhere after the model downloads.
