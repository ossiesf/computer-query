// Renders the chat log.
import { shortName } from "../models";
import { wordCount } from "../thinking";
import { copyButton } from "./clipboard";
import { renderRichText } from "./richText";
import type { ChatEntry, ReplyMeta, TokenInfo } from "../types";
import { el } from "./dom";

const STYLE_TAG_HELP =
  "Style check: each answer is checked for first-person words, feelings, greetings, and flattery (code is ignored). " +
  "If it fails, the model rewrites it, up to 2 tries; if no rewrite passes, the original answer is kept. Settings → Style enforcement.";

export interface DisplayOptions
{
  showReasoning: boolean;
  showLogprobs: boolean;
  showStats: boolean;
  showRequest: boolean;
}

/** A reply that is still streaming in. */
export interface PendingReply
{
  setText(text: string): void;
  /** A small status line under the reply, e.g. "Checking style…". */
  setNote(text: string): void;
  /** True once Stop was pressed. */
  readonly stopped: boolean;
  remove(): void;
}

/** How unanswered questions offer to be asked again. */
export interface RetryOptions
{
  /** True when asking again would work (a model is loaded). */
  canRetry: () => boolean;
  onRetry: (entry: Extract<ChatEntry, { role: "user" }>) => void;
}

type AssistantEntry = Extract<ChatEntry, { role: "assistant" }>;

/** Dev mode: ✓/✗ buttons to label whether an answer is in style. */
export interface LabelOptions
{
  onLabel: (entry: AssistantEntry, label: "good" | "bad") => void;
}

export class ChatView
{
  constructor(
    private readonly log: HTMLElement,
    private readonly display: () => DisplayOptions,
    private readonly retry: RetryOptions,
    private readonly labels: LabelOptions | null = null,
  )
  {}

  render(entries: readonly ChatEntry[]): void
  {
    this.log.textContent = "";
    entries.forEach((entry) => this.append(entry));
  }

  /** Adds an entry and returns its element. */
  append(entry: ChatEntry): HTMLElement
  {
    const message = el("div", { className: `msg ${entry.role}` });

    if (entry.role === "note" && entry.danger) message.classList.add("danger");

    const body = el("div", { className: "body", text: entry.content });

    if (entry.role === "assistant") renderRichText(body, entry.content); // code blocks, inline code
    message.append(body);
    if (entry.role === "assistant" && entry.meta) this.addReplyDetails(message, body, entry.meta, entry.content);

    if (entry.role === "assistant" && entry.meta?.styleRunId !== undefined && this.labels)
    {
      message.append(this.labelButtons(entry));
    }

    if (entry.role === "user" && entry.unanswered && this.retry.canRetry())
    {
      const button = el("button", { className: "small ask-again", text: "↻ Ask again" });

      button.type = "button";
      button.addEventListener("click", () => this.retry.onRetry(entry));
      message.append(button);
    }

    this.log.append(message);
    this.scrollToEnd();

    return message;
  }

  /**
   * Shows a placeholder reply that can be updated as text streams in. Until the first text
   * arrives it shows animated dots, so a pause before the answer doesn't look like nothing happened.
   */
  pending(onStop: () => void): PendingReply
  {
    const message = this.append({ role: "assistant", content: "" });
    const body = message.querySelector<HTMLElement>(".body")!;
    const showWaiting = () => body.replaceChildren(waitingDots());

    // Under the reply: a Stop button, then a status note ("Checking style…").
    const stop = el("button", { className: "small stop-btn", text: "Stop" });
    const note = el("span");
    let stopped = false;

    stop.type = "button";
    stop.setAttribute("aria-label", "Stop this reply");
    stop.addEventListener("click", () =>
    {
      stopped = true;
      stop.disabled = true;
      stop.textContent = "Stopping…";
      onStop();
    });

    // Show the waiting dots, with the Stop line under them.
    const metaLine = el("div", { className: "meta pending-meta" });

    metaLine.append(stop, note);
    message.append(metaLine);
    showWaiting();

    return {
      get stopped()
      {
        return stopped;
      },
      setText: (text) =>
      {
        if (text.trim() === "") showWaiting();
        else renderRichText(body, text);

        this.scrollToEnd();
      },
      setNote: (text) =>
      {
        note.textContent = text;
        this.scrollToEnd();
      },
      remove: () => message.remove(),
    };
  }

  /** A note shown temporarily (not saved to history). Returns a function that removes it. */
  transientNote(text: string): () => void
  {
    const message = this.append({ role: "note", content: text });

    return () => message.remove();
  }

  private addReplyDetails(message: HTMLElement, body: HTMLElement, meta: ReplyMeta, content: string): void
  {
    const { showReasoning, showLogprobs, showStats, showRequest } = this.display();

    if (meta.reasoning && showReasoning)
    {
      const details = el("details", { className: "reasoning" });

      details.append(
        el("summary", { text: `Reasoning (${wordCount(meta.reasoning)} words)` }),
        el("pre", { text: meta.reasoning }),
      );
      message.insertBefore(details, body);
    }

    if (meta.tokens && showLogprobs)
    {
      const alternatives = el("div", { className: "alts" });

      renderTokens(body, meta.tokens, alternatives);
      message.append(alternatives);
    }

    const metaLine = el("div", { className: "meta" });

    if (meta.tag)
    {
      const tag = el("span", { className: meta.tone ?? "", text: meta.tag });

      tag.title = meta.styleLog?.length ? `${STYLE_TAG_HELP}\n\nThis answer:\n${meta.styleLog.join("\n")}` : STYLE_TAG_HELP;
      metaLine.append(tag);
    }

    if (meta.stats && showStats) metaLine.append(el("span", { text: meta.stats }));
    if (meta.model) metaLine.append(el("span", { text: shortName(meta.model) }));
    metaLine.append(copyButton(() => content, "Copy answer"));
    message.append(metaLine);

    if (meta.request && showRequest)
    {
      const details = el("details");

      details.append(el("summary", { text: "Exact request sent" }), el("pre", { text: meta.request }));
      message.append(details);
    }
  }

  /** "In style? ✓ ✗" — clicking the selected one again clears the label. */
  private labelButtons(entry: AssistantEntry): HTMLElement
  {
    const row = el("div", { className: "label-row", text: "In style? " });

    for (const [label, text] of [["good", "✓"], ["bad", "✗"]] as const)
    {
      const button = el("button", { className: "small label-btn", text });

      button.type = "button";
      button.setAttribute("aria-label", label === "good" ? "In style" : "Not in style");
      button.setAttribute("aria-pressed", String(entry.meta?.styleLabel === label));
      button.addEventListener("click", () => this.labels?.onLabel(entry, label));
      row.append(button);
    }

    return row;
  }

  private scrollToEnd(): void
  {
    this.log.scrollTop = this.log.scrollHeight;
  }
}

/** Three dots that fill in one by one (". .. ..."), shown while waiting for the first text. */
function waitingDots(): HTMLElement
{
  const dots = el("span", { className: "waiting" });

  dots.setAttribute("role", "status");
  dots.setAttribute("aria-label", "Waiting for the answer");
  dots.append(el("span", { text: "." }), el("span", { text: "." }), el("span", { text: "." }));

  return dots;
}

/** Shades each token by the model's uncertainty; clicking shows the alternatives it considered. */
function renderTokens(body: HTMLElement, tokens: TokenInfo[], alternativesLine: HTMLElement): void
{
  body.textContent = "";

  for (const [token, logprob, alternatives] of tokens)
  {
    const probability = Math.exp(logprob);
    const options = alternatives
      .map(([text, lp]) => `${JSON.stringify(text)} ${(Math.exp(lp) * 100).toFixed(1)}%`)
      .join("  ·  ");

    const span = el("span", { className: "tok", text: token });

    span.style.background = `rgba(232, 106, 95, ${((1 - probability) * 0.65).toFixed(3)})`;
    span.title = options;
    span.addEventListener("click", () =>
    {
      alternativesLine.textContent = `Chosen ${JSON.stringify(token)} ${(probability * 100).toFixed(1)}%  —  candidates: ${options}`;
    });
    body.append(span);
  }
}
