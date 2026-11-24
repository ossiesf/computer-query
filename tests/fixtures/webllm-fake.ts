// A fake @mlc-ai/web-llm for end-to-end tests (wired in by `vite --mode e2e`).
// Tests control it through `window.__fakeLLM` and localStorage, set in an init script.

interface FakeControls
{
  /** Replies returned in order; the last one repeats. */
  replies?: string[];
  /** Milliseconds each load phase takes. */
  phaseMs?: number;
  /** If set, loading throws this message. */
  failLoad?: string;
  /** Only fail this many loads, then succeed. Unset = always fail. */
  failLoadTimes?: number;
  /** Replies to style-check requests, in order. Default: "PASS". */
  verdicts?: string[];
  /** Replies to style-fix (rewrite) requests, in order. Default: the text to rewrite, unchanged. */
  rewrites?: string[];
  /** Milliseconds before the first word of an answer arrives (the model "thinking" silently). */
  firstTokenMs?: number;
  /** Milliseconds between words, to test what happens while an answer is still streaming. */
  wordMs?: number;
}

declare global
{
  interface Window
  {
    __fakeLLM?: FakeControls;
    __fakeLLMRequests?: unknown[];
  }
}

const CACHE_KEY = "fake-webllm-cache";
const controls = (): FakeControls => window.__fakeLLM ?? {};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function cachedIds(): string[]
{
  return JSON.parse(localStorage.getItem(CACHE_KEY) ?? "[]") as string[];
}

export async function hasModelInCache(id: string): Promise<boolean>
{
  return cachedIds().includes(id);
}

export async function deleteModelAllInfoInCache(id: string): Promise<void>
{
  localStorage.setItem(CACHE_KEY, JSON.stringify(cachedIds().filter((x) => x !== id)));
}

type Progress = (report: { text: string; progress: number }) => void;

/** Emits the same progress messages WebLLM does, so the dev timer sees real phases. */
async function fakeLoad(id: string, report: Progress): Promise<void>
{
  const ms = controls().phaseMs ?? 30;

  if (!cachedIds().includes(id))
  {
    for (let i = 1; i <= 3; i++)
    {
      report({ text: `Fetching param cache[${i}/3]: ${i * 300}MB fetched. ${i * 33}% completed`, progress: i / 3 });
      await sleep(ms);
    }

    localStorage.setItem(CACHE_KEY, JSON.stringify([...cachedIds(), id]));
  }

  report({ text: "Loading model from cache[1/1]: 900MB loaded.", progress: 1 });
  await sleep(ms);
  report({ text: "Loading GPU shader modules[1/10]: 10% completed", progress: 0.1 });
  await sleep(ms);

  const c = controls();

  if (c.failLoad && (c.failLoadTimes === undefined || c.failLoadTimes-- > 0)) throw new Error(c.failLoad);
  report({ text: "Finish loading on WebGPU - fake", progress: 1 });
}

let replyIndex = 0;

function nextReply(): string
{
  const replies = controls().replies ?? ["Photosynthesis: plants convert light into sugar."];

  return replies[Math.min(replyIndex++, replies.length - 1)];
}

export async function CreateMLCEngine(id: string, config: { initProgressCallback: Progress })
{
  let report = config.initProgressCallback;
  let interrupted = false;

  await fakeLoad(id, report);

  return {
    setInitProgressCallback: (cb: Progress) => (report = cb),
    reload: (nextId: string) => fakeLoad(nextId, report),
    unload: async () =>
    {},
    interruptGenerate: () =>
    {
      interrupted = true;
    },
    chat: {
      completions: {
        async create(request: {
          stream?: boolean;
          messages: { content: string }[];
          logprobs?: boolean;
          extra_body?: { enable_thinking?: boolean };
        })
        {
          (window.__fakeLLMRequests ??= []).push(request);

          // Short non-streaming requests: the style check (judge) and the style fix (rewrite).
          if (request.stream === false)
          {
            const isJudge = request.messages[0].content.includes("PASS or FAIL");
            const lastInput = request.messages.at(-1)?.content ?? "";
            const content = isJudge
              ? (controls().verdicts?.shift() ?? "PASS")
              : (controls().rewrites?.shift() ?? lastInput.match(/<<<\n([\s\S]*)\n>>>/)?.[1] ?? lastInput);

            return { choices: [{ message: { content } }] };
          }

          // Like Qwen3: with thinking on, reason (in first person) inside <think> before answering.
          const thinking = request.extra_body?.enable_thinking
            ? "<think>\nI need to recall how plants make food. I think the answer is photosynthesis.\n</think>\n\n"
            : "";
          const words = (thinking + nextReply()).split(/(?=\s)/);

          const firstTokenMs = controls().firstTokenMs ?? 0;
          const wordMs = controls().wordMs ?? 0;

          interrupted = false;

          return (async function* ()
          {
            if (firstTokenMs) await sleep(firstTokenMs);

            for (const word of words)
            {
              if (interrupted) break; // like WebLLM: Stop ends the stream, keeping what was written
              if (wordMs) await sleep(wordMs);

              const logprobs = request.logprobs
                ? { content: [{ token: word, logprob: -0.2, top_logprobs: [{ token: word, logprob: -0.2 }, { token: " x", logprob: -2 }] }] }
                : null;

              yield { choices: [{ delta: { content: word }, logprobs }] };
            }

            yield {
              choices: [],
              usage: { prompt_tokens: 120, completion_tokens: words.length, extra: { decode_tokens_per_s: 25, time_to_first_token_s: 0.3 } },
            };
          })();
        },
      },
    },
  };
}
