// Thin wrapper around WebLLM: loading, generating, and the model cache.
import type * as WebLLM from "@mlc-ai/web-llm";
import type { SamplingParams } from "./conversation";
import { removeEmptyCodeBlocks } from "./style";
import { splitThinking, type ThinkingSplit } from "./thinking";
import type { ChatMessage, TokenInfo } from "./types";

// WebLLM is ~5 MB of JavaScript. Importing it lazily lets the page render first.
let library: Promise<typeof WebLLM> | null = null;
const webllm = () => (library ??= import("@mlc-ai/web-llm"));

export interface LoadProgress
{
  text: string;
  progress: number;
}

export interface Usage
{
  promptTokens: number;
  completionTokens: number;
  tokensPerSecond?: number;
  timeToFirstTokenSec?: number;
}

export interface Generation
{
  /** The answer, with any <think> block removed. */
  text: string;
  /** The <think> reasoning, or "" if there was none. */
  reasoning: string;
  tokens: TokenInfo[];
  usage: Usage | null;
  /** The exact request, as pretty-printed JSON, for the "Show exact request" view. */
  request: string;
}

export interface GenerateOptions
{
  params: SamplingParams;
  withLogprobs: boolean;
  /** true/false for models that can think (Qwen3); undefined for models that can't. */
  thinking?: boolean;
  /** Called with the reasoning and answer so far as each chunk arrives. */
  onText?: (soFar: ThinkingSplit) => void;
}

export class LocalModel
{
  private engine: WebLLM.MLCEngineInterface | null = null;
  private loading: Promise<void> | null = null;
  private onProgress: (p: LoadProgress) => void = () =>
  {};

  /** ID of the model currently in GPU memory, or null. */
  loadedId: string | null = null;

  get isLoading(): boolean
  {
    return this.loading !== null;
  }

  /** Resolves when any in-progress load finishes (successfully or not). */
  async whenLoaded(): Promise<void>
  {
    await this.loading?.catch(() =>
    {});
  }

  /** Loads a model into GPU memory. Concurrent calls share the same load. */
  load(id: string, contextWindow: number, onProgress: (p: LoadProgress) => void): Promise<void>
  {
    if (this.loading) return this.loading;
    this.onProgress = onProgress;
    this.loading = this.doLoad(id, contextWindow).finally(() =>
    {
      this.loading = null;
    });

    return this.loading;
  }

  private async doLoad(id: string, contextWindow: number): Promise<void>
  {
    const chatOptions = { context_window_size: contextWindow };
    const initProgressCallback = (report: WebLLM.InitProgressReport) =>
      this.onProgress({ text: report.text, progress: report.progress });

    this.loadedId = null;

    if (this.engine)
    {
      this.engine.setInitProgressCallback(initProgressCallback);
      await this.engine.reload(id, chatOptions);
    }
    else
    {
      const { CreateMLCEngine } = await webllm();

      this.engine = await CreateMLCEngine(id, { initProgressCallback }, chatOptions);
    }

    this.loadedId = id;
  }

  async unload(): Promise<void>
  {
    await this.engine?.unload();
    this.loadedId = null;
  }

  interrupt(): void
  {
    this.engine?.interruptGenerate();
  }

  async generate(messages: ChatMessage[], options: GenerateOptions): Promise<Generation>
  {
    if (!this.engine || !this.loadedId) throw new Error("No model loaded");

    const request: WebLLM.ChatCompletionRequestStreaming = {
      messages,
      ...options.params,
      stream: true,
      stream_options: { include_usage: true },
      ...(options.withLogprobs ? { logprobs: true, top_logprobs: 5 } : {}),
      ...(options.thinking !== undefined ? { extra_body: { enable_thinking: options.thinking } } : {}),
    };

    let text = "";
    const tokens: TokenInfo[] = [];
    let usage: Usage | null = null;

    for await (const chunk of await this.engine.chat.completions.create(request))
    {
      if (chunk.usage) usage = toUsage(chunk.usage);

      const choice = chunk.choices[0];

      if (!choice) continue;
      text += choice.delta.content ?? "";

      for (const t of choice.logprobs?.content ?? [])
      {
        tokens.push([t.token, t.logprob, t.top_logprobs.map((alt) => [alt.token, alt.logprob])]);
      }

      options.onText?.(splitThinking(text));
    }

    const { answer, reasoning } = splitThinking(text);

    return {
      text: removeEmptyCodeBlocks(answer),
      reasoning,
      tokens,
      usage,
      request: JSON.stringify(
        { model: this.loadedId, ...options.params, ...(request.extra_body ? { extra_body: request.extra_body } : {}), messages },
        null,
        2,
      ),
    };
  }

  /**
   * A short, non-streaming request (used for the style check and fix).
   * Thinking is switched off on models that support it, so the answer comes immediately.
   */
  async complete(
    messages: ChatMessage[],
    options: { maxTokens: number; temperature: number; canThink: boolean },
  ): Promise<string>
  {
    if (!this.engine || !this.loadedId) throw new Error("No model loaded");

    const request: WebLLM.ChatCompletionRequestNonStreaming = {
      messages,
      stream: false,
      temperature: options.temperature,
      max_tokens: options.maxTokens,
      ...(options.canThink ? { extra_body: { enable_thinking: false } } : {}),
    };
    const reply = await this.engine.chat.completions.create(request);

    return splitThinking(reply.choices[0]?.message.content ?? "").answer;
  }
}

function toUsage(u: WebLLM.CompletionUsage): Usage
{
  const extra = u.extra as { decode_tokens_per_s?: number; time_to_first_token_s?: number } | undefined;

  return {
    promptTokens: u.prompt_tokens,
    completionTokens: u.completion_tokens,
    tokensPerSecond: extra?.decode_tokens_per_s,
    timeToFirstTokenSec: extra?.time_to_first_token_s,
  };
}

export function formatUsage(u: Usage | null): string
{
  if (!u) return "";

  const speed = u.tokensPerSecond?.toFixed(1) ?? "?";
  const ttft = u.timeToFirstTokenSec?.toFixed(2) ?? "?";

  return `prompt ${u.promptTokens} tok · output ${u.completionTokens} tok · ${speed} tok/s · first token ${ttft}s`;
}

export async function isModelCached(id: string): Promise<boolean>
{
  try
  {
    return await (await webllm()).hasModelInCache(id);
  }
  catch
  {
    return false;
  }
}

export async function deleteCachedModel(id: string): Promise<void>
{
  await (await webllm()).deleteModelAllInfoInCache(id);
}
