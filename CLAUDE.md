# Computer Query: guide for Claude (and contributors)

**Base rules:** `OPUS_CODE_INSTRUCTIONS.md` (Ossie's general coding guide, kept in the Career Profiles folder, outside this repo). This file adds what is specific to this project. Where the two conflict, this file wins for this repo.

## What this is

A free AI assistant for learning that runs entirely in the browser (WebLLM + WebGPU). It was built with an optional impersonal "ship's computer" style (off in v1, see below). No servers, no accounts, no data collection. Portfolio piece for the evals/quality-infrastructure pitch: the interesting parts are the style-enforcement pipeline and how it is measured.

**Decision (Ossie, 2026-11-22): v1 ships without the ship's-computer voice.** No system prompt; the canned reply and style check are off by default. The code and `SHIP_COMPUTER_PROMPT` stay for later, and e2e tests seed the ship settings so the pipeline stays covered. Don't turn them back on without asking.

## Product rules (never break these)

- **Nothing leaves the device** after the model download. No analytics, no remote logging, no network calls from app code. Dev-mode data stays in IndexedDB; export is manual.
- **Student privacy first.** Never add anything that stores or sends data about a user without an explicit, documented decision. Shared school devices are a real case (see "classroom mode" in the plan).
- **Model output is never HTML.** Render with `textContent` / DOM nodes only (`src/markdown.ts` → `src/ui/richText.ts`). A test checks this; keep it passing.
- **Failing gracefully beats failing loudly.** The style check, a rewrite, or a load can fail; the user must still get their answer or a clear next step ("Ask again", a smaller model).
- **UI text is plain and neutral** (buttons, tags, status), not ship's-computer cosplay. (The impersonal reply voice is optional after the 2026-11-22 decision above; it's no longer a product rule.)

## Architecture rules

- **Pure logic** (`style.ts`, `respond.ts`, `repeat.ts`, `conversation.ts`, `commands.ts`, `models.ts`, `markdown.ts`, `inputHistory.ts`, `dev/loadTimer.ts`, `dev/styleLog.ts` summaries): no DOM, no browser APIs, fully unit-tested. New decision-making code goes here.
- **Wrappers** (`engine.ts`, `device.ts`, `storage.ts`, `dev/devDb.ts`): thin; side effects only.
- **UI** (`ui/`): one class per part of the screen. **Dev-only UI** (`dev/`): only constructed when `?dev=1`.
- **`app.ts` wires things together.** If it starts making decisions, move the decision into a pure module.
- **Saved data has versions.** Any change to `Settings`, `AppState`, or chat entries needs a migration in `storage.ts` plus a unit test. Changing the default system prompt means adding the old one to `PREVIOUS_DEFAULT_PROMPTS`.

## Code style

Enforced by `npm run lint` (ESLint + `@stylistic` + one local rule in `eslint-rules/`); `npm run lint:fix` applies it.
- **Opening braces on their own line** (Allman) for functions, classes, methods, arrow-function bodies, `if`/`else`/loops/`try`, interfaces, enums. Object literals and inline types (`{ a: 1 }`, `{ x: number }`) stay inline: they are data, not blocks.
- **Code in paragraphs:** each logical step is its own group, separated by a blank line. The linter forces blank lines around blocks, before `return`, and around declarations; it keeps a run of declarations together, so **split runs that mix steps by hand** and give a step a one-line comment when its purpose isn't obvious from the code.
- **Prettier is deliberately not used** (a deviation from the base guide): it cannot do Allman braces and would undo them.

## Prompts for small models

Lessons learned on this project (1–4B models):
- Concrete beats abstract: "one sentence before each code block", not "narrate briefly".
- Examples beat rules, and **models copy example wording**: an example that says "Output: …" produces labels. Write examples exactly as answers should look.
- Recency wins: instructions next to the question (the format reminder) outweigh the system prompt, and **models copy the format of earlier answers in the history**.
- Temperature 0 repeats itself: a retry must change the input (send back the failed attempt) and/or raise the temperature.
- **Never claim a prompt change works until it has run on the real model.** Say "untested on Qwen" until it has.

## Testing

Three layers, each with one job:

| Layer | Model | Proves |
|---|---|---|
| Unit (`npm test`) | none | Pure logic |
| E2E (`npm run test:e2e`) | Fake (`tests/fixtures/webllm-fake.ts`) | The app handles every kind of model response, including rare failure branches; UI behavior. Runs in CI. |
| Real model (planned: `test:real`, `eval:style`) | Real Qwen on a GPU | The model actually behaves: check accuracy, rewrite quality, timing. Loose assertions. Runs on Ossie's Mac. |

- Fake-model tests never prove model quality. Don't describe them as if they do.
- Every bug fix ships with a regression test built from the real failing example (e.g. the `for i in range(5)` style false alarm).
- Web-first assertions only (`expect(locator)…`); no sleeps; test names describe behavior.

## Workflow for Claude

1. **Before editing Ossie's folder, check for his changes** since the last delivery (files newer than the last write). Never overwrite his edits; merge or ask.
2. **For anything multi-file, give a short plan in chat first.** Ask before rewriting more than ~50 lines of working code, adding a dependency, or changing a product rule above.
3. **Definition of done:** `npm run check` green (typecheck + lint + unit + e2e), `npm run build` succeeds, README file map and behavior notes updated, UI changes checked with a screenshot.
4. **Deliver** source + tests; GitHub Pages deploys `dist/` from CI on push to `main`.
5. **Report honestly:** what changed, what was verified and how, what is untested (especially real-model behavior). No overclaiming.

## Communication

Direct, concise, technically precise. Lead with the answer. Plain words over jargon in user-facing text. Say when something is a guess.

## Known gaps vs the base guide (fix these)

- No `docs/DESIGN.md`, `docs/WORKING_NOTES.md`, or `docs/AI_WORKFLOW.md`.
- Use conventional commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`). CI (`.github/workflows/ci.yml`) runs every check and deploys `dist/` to GitHub Pages from `main` only when they pass.
- Real-model test layer (`test:real`, `eval:style`) not built.
- Several large rewrites happened without the >50-line check-in; follow rule 2 from here on.
