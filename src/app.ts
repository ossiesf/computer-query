// Connects state, the model, and the UI. Most logic lives in the modules this file imports.
import { APP_VERSION, MODEL_FAMILIES, THINKING_TOKEN_BUDGET } from "./config";
import { helpText, parseInput, type CommandName } from "./commands";
import { buildMessages, lastAnsweredTurn, samplingParams } from "./conversation";
import { describeDevice } from "./device";
import { deviceFields, loadLog } from "./dev/loadLog";
import { setStyleLabel, styleLog } from "./dev/styleLog";
import { LoadTimer } from "./dev/loadTimer";
import type { DevView } from "./dev/devView";
import { LocalModel, deleteCachedModel, formatUsage, isModelCached, type LoadProgress } from "./engine";
import {
  familyByKey,
  familyForModelId,
  modelId,
  resolveModel,
  shortName,
  smallerFamily,
  type ResolvedModel,
} from "./models";

import { addToHistory } from "./inputHistory";
import { generateStyledReply, type RepeatGuard } from "./respond";
import { clearSavedState, freshState, loadState, parseState, saveState } from "./storage";
import { CANNED_RELATIONSHIP_REPLY, isRelationshipQuestion } from "./style";
import { wordCount } from "./thinking";
import type { AppState, ChatEntry, DeviceInfo, FamilyKey, ReplyMeta, Settings } from "./types";
import { ChatView } from "./ui/chatView";
import { Composer } from "./ui/composer";
import { byId, downloadFile, today } from "./ui/dom";
import { ModelPicker } from "./ui/modelPicker";
import { SettingsDialog, type SettingsChange } from "./ui/settingsDialog";
import { ThinkToggle } from "./ui/thinkToggle";

const RESET_CONFIRM_WINDOW_MS = 60_000;
/** Model selected when Think is turned on with a model that can't reason. */
const THINKING_FALLBACK: FamilyKey = "qwen3_17b";

type Trigger = "manual" | "auto";
type UserEntry = Extract<ChatEntry, { role: "user" }>;

export class App
{
  private state: AppState = loadState();
  private device: DeviceInfo = { webgpu: false };
  private readonly model = new LocalModel();
  /** Context window the loaded model was loaded with (changing it needs a reload). */
  private loadedContext: number | null = null;
  /** Running model sync, if any. Questions asked meanwhile wait for it. */
  private syncing: Promise<void> | null = null;
  private busy = false;
  /** Time until which "/reset confirm" is accepted; 0 = no reset pending. */
  private resetDeadline = 0;

  private readonly statusLine = byId("status");
  private readonly progressBar = byId<HTMLProgressElement>("progress");

  private readonly chat: ChatView;
  private readonly composer = new Composer(
    {
      form: byId<HTMLFormElement>("composer"),
      input: byId<HTMLTextAreaElement>("input"),
      menu: byId<HTMLUListElement>("cmdMenu"),
      sendButton: byId<HTMLButtonElement>("sendButton"),
    },
    () => this.state.notes,
    () => this.state.inputHistory,
    (text) => void this.handleInput(text),
  );

  private readonly picker = new ModelPicker(byId<HTMLSelectElement>("modelPicker"), (value) => this.pickModel(value));
  private readonly settingsDialog: SettingsDialog;
  private readonly thinkToggle = new ThinkToggle(byId<HTMLButtonElement>("thinkButton"), byId("thinkState"), () =>
    this.toggleThinking(),
  );

  constructor(private readonly dev: DevView | null)
  {
    this.chat = new ChatView(
      byId("log"),
      () => this.settings,
      {
        canRetry: () => this.model.loadedId !== null && !this.syncing,
        onRetry: (entry) => void this.askAgain(entry),
      },
      // Dev mode only: ✓/✗ buttons to label answers, for measuring the style check.
      dev ? { onLabel: (entry, label) => void this.labelAnswer(entry, label) } : null,
    );
    this.settingsDialog = new SettingsDialog(() => this.settings, () => this.state.notes, {
      changed: (kind) => this.onSettingsChanged(kind),
      opened: () => void this.refreshModelInfo(),
      closed: () => this.composer.focus(),
      deleteModel: () => void this.deleteSelectedModel(),
      notesChanged: () => this.onNotesChanged(),
      exportData: () => this.exportData(),
      importData: (file) => void this.importData(file),
      clearChat: () => this.clearChat(),
      resetData: () => this.resetData(),
    });
  }

  private get settings(): Settings
  {
    return this.state.settings;
  }

  /** Shows saved chat right away, then loads a model as soon as the device check finishes. */
  start(devicePromise: Promise<DeviceInfo>): void
  {
    this.chat.render(this.state.chat);
    this.setStatus("Checking this device…");
    this.track(this.startUp(devicePromise));
  }

  private async startUp(devicePromise: Promise<DeviceInfo>): Promise<void>
  {
    this.device = await devicePromise;
    this.dev?.setDevice(this.device);
    void this.dev?.refresh();
    this.updateThinkButton();
    void this.refreshModelInfo();

    if (!this.device.webgpu)
    {
      this.picker.setDisabled(true);
      this.setStatus("WebGPU unavailable in this browser. Use a current Chrome, Edge, or Safari 26+ on a device with a supported GPU.");

      return;
    }

    if (this.settings.autoLoad) await this.loadSelectedModel("auto");
    else this.setStatus("No model loaded. Pick one from the model menu.");
  }

  /** Opens Settings scrolled to the dev timing table. */
  openDevTable(): void
  {
    this.settingsDialog.open(this.dev?.section);
  }

  // ---------- Model loading ----------

  /** Loads whatever the settings call for. Calls during a load share it, then re-check the selection. */
  private syncModel(trigger: Trigger): Promise<void>
  {
    return this.syncing ?? this.track(this.loadSelectedModel(trigger));
  }

  /** Marks a task as the running sync, so questions wait for it, and refreshes the UI when it ends. */
  private track(task: Promise<void>): Promise<void>
  {
    const tracked = task.finally(() =>
    {
      this.syncing = null;
      this.updateThinkButton();
      this.chat.render(this.state.chat); // shows "Ask again" on unanswered questions once a model is ready
      void this.refreshModelInfo();
    });

    this.syncing = tracked;

    return tracked;
  }

  /**
   * Keeps loading until the loaded model matches the selection, since the selection can change mid-load.
   * In Auto mode, a failed load steps down to the next smaller model and tries again.
   */
  private async loadSelectedModel(trigger: Trigger): Promise<void>
  {
    let fellBackFrom: string | null = null;

    for (;;)
    {
      if (!this.device.webgpu) return;

      const target = resolveModel(this.settings, this.device);

      if (this.model.loadedId === target.id && this.loadedContext === this.settings.contextWindow) return;

      if (target.precision === "f16" && !this.device.f16)
      {
        this.setStatus("This GPU lacks shader-f16. Set Precision to Auto or q4f32 in Settings.");

        return;
      }

      const error = await this.loadOnce(target, trigger);

      if (error === null)
      {
        if (fellBackFrom) this.appendStatus(` · ${fellBackFrom} didn't fit in GPU memory, so Auto switched to this smaller model`);
        continue; // loop once more in case the selection changed meanwhile
      }

      const smaller = smallerFamily(target.family.key);

      if (this.settings.model === "auto" && smaller)
      {
        this.settings.autoCap = smaller.key;
        this.save();
        fellBackFrom ??= target.family.name;
        this.setStatus(`Load failed (${error}). Trying ${smaller.name}…`);
        continue;
      }

      this.setStatus(
        `Load failed: ${error}` + (smaller ? " — likely out of GPU memory. Pick a smaller model from the menu." : ""),
      );

      return;
    }
  }

  /** Loads one model. Returns null on success, or the error message. */
  private async loadOnce(target: ResolvedModel, trigger: Trigger): Promise<string | null>
  {
    const { id, precision } = target;
    const contextWindow = this.settings.contextWindow;

    // Dev mode: time each load phase and show it live.
    const cold = this.dev ? !(await isModelCached(id)) : null;
    const timer = this.dev ? new LoadTimer() : null;

    if (timer) this.dev?.startLive({ model: id, prec: precision, cold, trigger, snapshot: () => timer.snapshot() });

    this.progressBar.hidden = false;
    this.progressBar.value = 0;
    this.loadedContext = null;

    let error: string | null = null;

    try
    {
      // Ask the browser not to evict the downloaded weights when space runs low.
      await navigator.storage?.persist?.().catch(() => false);

      await this.model.load(id, contextWindow, (p: LoadProgress) =>
      {
        this.setStatus(p.text);
        this.progressBar.value = p.progress;
        timer?.onProgress(p.text);
      });

      this.loadedContext = contextWindow;
      this.setStatus(`Model online: ${shortName(id)} (${precision}) · context ${contextWindow} tokens`);
    }
    catch (e)
    {
      error = e instanceof Error ? e.message : String(e);
    }
    finally
    {
      this.progressBar.hidden = true;
    }

    if (timer && this.dev)
    {
      this.dev.endLive();

      const timing = timer.finish();

      await this.dev.record({
        ts: new Date().toISOString(), appVersion: APP_VERSION, trigger, model: id, prec: precision, contextWindow,
        cold, ok: error === null, error, ...timing, ...deviceFields(this.device), userAgent: navigator.userAgent,
      });

      if (error === null) this.appendStatus(` · loaded in ${(timing.totalMs / 1000).toFixed(1)}s (${cold ? "cold" : "warm"})`);
    }

    return error;
  }

  /** The header menu: picking a model loads it. */
  private pickModel(value: Settings["model"]): void
  {
    this.settings.model = value;
    this.save();
    this.updateThinkButton();
    void this.syncModel("manual");
  }

  private async deleteSelectedModel(): Promise<void>
  {
    if (!this.device.webgpu) return;

    const { id } = resolveModel(this.settings, this.device);

    try
    {
      if (this.model.loadedId === id)
      {
        await this.model.unload();
        this.loadedContext = null;
      }

      await deleteCachedModel(id);
      this.setStatus(`Deleted ${shortName(id)}'s download. Pick a model from the menu to load one.`);
    }
    catch (e)
    {
      this.setStatus(`Delete failed: ${e instanceof Error ? e.message : e}`);
    }

    this.updateThinkButton();
    void this.refreshModelInfo();
  }

  /** Updates the model menu labels, the device check, and storage usage. */
  private async refreshModelInfo(): Promise<void>
  {
    const { precision, recommendation } = resolveModel(this.settings, this.device);
    const labelFor = async (value: Settings["model"], familyKey: FamilyKey) =>
    {
      const family = familyByKey(familyKey);
      const downloaded = await isModelCached(modelId(family, precision));
      const size = `${(family.vramMB[precision] / 1000).toFixed(1)} GB`;
      const name = value === "auto" ? `Auto: ${family.name}` : family.name;

      return { value, label: `${name} · ${size}${downloaded ? " ✓" : ""}` };
    };

    this.picker.setOptions(
      await Promise.all([labelFor("auto", recommendation.family.key), ...MODEL_FAMILIES.map((f) => labelFor(f.key, f.key))]),
      this.settings.model,
    );

    this.settingsDialog.setDeviceInfo(
      this.device.webgpu
        ? `${describeDevice(this.device)}\nRecommended: ${recommendation.family.name} ${recommendation.precision} — ${recommendation.reason}. ` +
            "This is a heuristic; browsers do not expose GPU memory."
        : "WebGPU unavailable.",
    );

    try
    {
      const estimate = await navigator.storage?.estimate?.();

      if (estimate?.usage != null && estimate.quota != null)
      {
        this.settingsDialog.setStorageInfo(
          `Browser storage used by this page: ${(estimate.usage / 1e6).toFixed(0)} MB (mostly model weights) of ~${(estimate.quota / 1e9).toFixed(1)} GB allowed.`,
        );
      }
    }
    catch
    {
      this.settingsDialog.setStorageInfo("Storage estimate unavailable.");
    }
  }

  // ---------- Input ----------

  private async handleInput(text: string): Promise<void>
  {
    this.state.inputHistory = addToHistory(this.state.inputHistory, text);
    this.save();

    if (this.resetDeadline && !/^\/reset\s+confirm\s*$/i.test(text))
    {
      if (Date.now() < this.resetDeadline) this.note("Reset cancelled. Nothing was deleted.");
      this.resetDeadline = 0;
    }

    const parsed = parseInput(text);

    if (parsed.kind === "command") return this.runCommand(parsed.name, parsed.arg);
    if (parsed.kind === "unknown-command") return this.note(`Unknown command: ${text}. Type /help.`);

    return this.ask(text);
  }

  private async ask(question: string): Promise<void>
  {
    const history = this.state.chat.slice();
    const entry: UserEntry = { role: "user", content: question };

    this.addEntry(entry);

    if (this.settings.styleCanned && isRelationshipQuestion(question))
    {
      this.addEntry({ role: "assistant", content: CANNED_RELATIONSHIP_REPLY, meta: { tag: "style: canned reply (model not called)" } });

      return;
    }

    this.setBusy(true);

    try
    {
      if (this.syncing) await this.waitForLoad();

      if (!this.model.loadedId)
      {
        this.markUnanswered(entry, "Not answered: no model is loaded. Once one loads, use Ask again on your question.");

        return;
      }

      await this.reply(entry, question, history);
    }
    finally
    {
      this.setBusy(false);
    }
  }

  /** Removes the unanswered question (and the note under it) and sends it again. */
  private async askAgain(entry: UserEntry): Promise<void>
  {
    if (this.busy) return;

    const index = this.state.chat.indexOf(entry);

    if (index === -1) return;

    const next = this.state.chat[index + 1];

    this.state.chat.splice(index, next?.role === "note" ? 2 : 1);
    this.save();
    this.chat.render(this.state.chat);
    await this.ask(entry.content);
  }

  private markUnanswered(entry: UserEntry, reason: string): void
  {
    entry.unanswered = true;
    this.state.chat.push({ role: "note", content: reason });
    this.save();
    this.chat.render(this.state.chat);
  }

  /** Holds a question while the model finishes loading. */
  private async waitForLoad(): Promise<void>
  {
    const removeNote = this.chat.transientNote("Please wait — model loading. Your question will be answered when loading finishes.");

    await this.syncing?.catch(() =>
    {});
    removeNote();
  }

  private async reply(entry: UserEntry, question: string, history: ChatEntry[]): Promise<void>
  {
    const pending = this.chat.pending(() => this.model.interrupt());
    const thinking = this.thinkingForRequest();
    const params = samplingParams(this.settings);

    // Reasoning shares the token limit with the answer, so give it its own budget.
    if (thinking) params.max_tokens += THINKING_TOKEN_BUDGET;

    try
    {
      const messages = buildMessages(this.settings, this.state.notes, history, question);
      const canThink = this.currentFamily().supportsThinking;

      // Repeat guard: what to compare against, and the same request without history.
      const repeatGuard: RepeatGuard = {
        question,
        previous: lastAnsweredTurn(history),
        withoutHistory: buildMessages(this.settings, this.state.notes, [], question),
      };

      // Answer, then check the style and fix it if needed.
      const result = await generateStyledReply(
        messages,
        {
          answer: (msgs) =>
            this.model.generate(msgs, {
              params,
              withLogprobs: this.settings.showLogprobs,
              thinking,
              onText: ({ reasoning, answer, reasoningDone }) =>
                pending.setText(reasoningDone ? answer : `Thinking… (${wordCount(reasoning)} words)`),
            }),
          complete: (msgs, opts) => this.model.complete(msgs, { ...opts, canThink }),
        },
        { check: this.settings.styleCheck, fix: this.settings.styleFix, repeatGuard, stopped: () => pending.stopped },
        (step) => pending.setNote(step),
      );

      // What appears under the reply: style tag, stats, model, and the details views.
      const { generation } = result;
      const meta: ReplyMeta = {
        tag: thinking ? `${result.tag} · thinking` : result.tag,
        tone: result.tone,
        stats: formatUsage(generation.usage),
        model: this.model.loadedId ?? undefined,
        request: generation.request,
        styleLog: result.log,
      };

      // Dev mode: record the check so it can be labeled ✓/✗ later.
      if (this.dev)
      {
        meta.styleRunId = await this.dev.recordStyleRun({
          ts: new Date().toISOString(), appVersion: APP_VERSION, model: this.model.loadedId ?? "",
          thinking: Boolean(thinking), checkMode: this.settings.styleCheck, fix: this.settings.styleFix,
          question, original: generation.text, shown: result.text, outcome: result.outcome, tag: result.tag, steps: result.steps,
        });
      }

      if (generation.reasoning) meta.reasoning = generation.reasoning;
      // Token shading covers the whole output, so it only lines up when there was no reasoning block.
      if (result.matchesTokens && !generation.reasoning && generation.tokens.length) meta.tokens = generation.tokens;

      // Show the answer (or explain why there isn't one).
      const text =
        result.text ||
        (generation.reasoning
          ? "(Reasoning reached the token limit before an answer. Turn Think off, or raise Max tokens in Settings.)"
          : "(empty reply)");

      pending.remove();
      this.addEntry({ role: "assistant", content: text, meta });
    }
    catch (e)
    {
      pending.remove();
      this.markUnanswered(entry, `Not answered: ${e instanceof Error ? e.message : e}`);
    }
  }

  /** Dev mode: your ✓/✗ on an answer. Clicking the same label again clears it. */
  private async labelAnswer(entry: Extract<ChatEntry, { role: "assistant" }>, label: "good" | "bad"): Promise<void>
  {
    if (!entry.meta?.styleRunId || !this.dev) return;

    const next = entry.meta.styleLabel === label ? undefined : label;

    entry.meta.styleLabel = next;
    this.save();
    this.chat.render(this.state.chat);
    await setStyleLabel(entry.meta.styleRunId, next).catch((e) => console.warn("Label not saved", e));
    await this.dev.refreshStyle();
  }

  // ---------- Think toggle ----------

  /** The loaded model, or the one that would load, so the Think button reflects it. */
  private currentFamily()
  {
    const loaded = this.model.loadedId ? familyForModelId(this.model.loadedId) : null;

    return loaded ?? resolveModel(this.settings, this.device).family;
  }

  /** true/false for models that can think; undefined (don't send the option) for those that can't. */
  private thinkingForRequest(): boolean | undefined
  {
    return this.currentFamily().supportsThinking ? this.settings.thinking : undefined;
  }

  private toggleThinking(): void
  {
    const turningOn = !this.settings.thinking;

    this.settings.thinking = turningOn;
    this.save();
    this.updateThinkButton();

    // Think needs a model that can reason: switch to one, the same as picking it from the menu.
    if (turningOn && !this.currentFamily().supportsThinking && this.device.webgpu)
    {
      this.picker.setValue(THINKING_FALLBACK);
      this.pickModel(THINKING_FALLBACK);
    }
  }

  private updateThinkButton(): void
  {
    const family = this.currentFamily();

    this.thinkToggle.update(this.settings.thinking, family.supportsThinking, family.name);
  }

  // ---------- Commands ----------

  private async runCommand(name: CommandName, arg: string): Promise<void>
  {
    switch (name)
    {
      case "remember":
        if (!arg) return this.note("Usage: /remember <text>");
        this.state.notes.push(arg);
        this.onNotesChanged();

        return this.note(`Note ${this.state.notes.length} stored: ${arg}`);

      case "forget": {
        const n = Number.parseInt(arg, 10);

        if (!Number.isInteger(n) || n < 1 || n > this.state.notes.length)
        {
          return this.note("Usage: /forget <note number>. Use /notes to list.");
        }

        const [removed] = this.state.notes.splice(n - 1, 1);

        this.onNotesChanged();

        return this.note(`Note ${n} deleted: ${removed}`);
      }

      case "notes":
        return this.note(
          this.state.notes.length
            ? "Stored notes:\n" + this.state.notes.map((note, i) => `${i + 1}. ${note}`).join("\n")
            : "No notes stored.",
        );

      case "clear":
        return this.clearChat();

      case "help":
        return this.note(helpText());

      case "reset":
        if (arg.toLowerCase() !== "confirm") return this.warnBeforeReset();
        if (Date.now() < this.resetDeadline) return this.resetEverything();

        return this.note("No reset pending, or the 60-second window expired. Type /reset to start again.");
    }
  }

  private async cachedModels()
  {
    const all = MODEL_FAMILIES.flatMap((family) => (["f16", "f32"] as const).map((precision) => ({ family, precision })));
    const cached = await Promise.all(all.map((m) => isModelCached(modelId(m.family, m.precision))));

    return all.filter((_, i) => cached[i]);
  }

  private async warnBeforeReset(): Promise<void>
  {
    this.resetDeadline = Date.now() + RESET_CONFIRM_WINDOW_MS;

    const models = await this.cachedModels();
    const chatCount = this.state.chat.filter((e) => e.role !== "note").length;
    const modelList = models.length
      ? `${models.map((m) => `${m.family.name} ${m.precision}`).join(", ")} (must be re-downloaded)`
      : "none";

    const lines = [
      "WARNING — this permanently deletes, from this browser:",
      `- ${chatCount} chat messages`,
      `- ${this.state.notes.length} stored notes`,
      "- all settings, including system prompt edits",
      `- downloaded models: ${modelList}`,
      ...(this.dev ? ["- dev load timings and style-check records"] : []),
      "This cannot be undone. To keep a copy first: Settings → Data → Export JSON.",
      "",
      "Type /reset confirm within 60 seconds to proceed. Any other input cancels.",
    ];

    this.addEntry({ role: "note", content: lines.join("\n"), danger: true });
  }

  private async resetEverything(): Promise<void>
  {
    this.resetDeadline = 0;
    this.setBusy(true);
    this.setStatus("Resetting — deleting models and data…");
    await this.model.unload().catch(() =>
    {});

    for (const m of await this.cachedModels())
    {
      await deleteCachedModel(modelId(m.family, m.precision)).catch(() =>
      {});
    }

    if (this.dev)
    {
      await loadLog.clear().catch(() =>
      {});
      await styleLog.clear().catch(() =>
      {});
    }

    clearSavedState();
    // Reload instead of saving, so the old state is never written back.
    this.setStatus("Reset complete. Reloading…");
    setTimeout(() => location.reload(), 800);
  }

  // ---------- Settings dialog actions ----------

  private onSettingsChanged(kind: SettingsChange): void
  {
    this.save();
    if (kind === "display") this.chat.render(this.state.chat);

    if (kind === "model")
    {
      this.updateThinkButton();
      void this.syncModel("manual");
    }
  }

  private onNotesChanged(): void
  {
    this.save();
    this.settingsDialog.renderNotes();
  }

  private exportData(): void
  {
    downloadFile(`computer-query-${today()}.json`, JSON.stringify(this.state, null, 2), "application/json");
  }

  private async importData(file: File): Promise<void>
  {
    try
    {
      this.state = parseState(JSON.parse(await file.text()));
      this.afterStateReplaced("Import complete.");
    }
    catch (e)
    {
      this.setStatus(`Import failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  private clearChat(): void
  {
    this.state.chat = [];
    this.save();
    this.chat.render(this.state.chat);
  }

  /** Clears settings, notes, and chat; keeps downloaded models. */
  private resetData(): void
  {
    clearSavedState();
    this.state = freshState();
    this.afterStateReplaced("Settings, notes, and chat cleared. Downloaded models kept.");
  }

  private afterStateReplaced(message: string): void
  {
    this.save();
    this.settingsDialog.refresh();
    this.chat.render(this.state.chat);
    this.setStatus(message);
    void this.syncModel("manual"); // the model setting may have changed
  }

  // ---------- Helpers ----------

  private addEntry(entry: ChatEntry): void
  {
    this.state.chat.push(entry);
    this.save();
    this.chat.append(entry);
  }

  private note(text: string): void
  {
    this.addEntry({ role: "note", content: text });
  }

  private save(): void
  {
    const error = saveState(this.state);

    if (error) this.setStatus(`Could not save to browser storage: ${error}`);
  }

  private setBusy(busy: boolean): void
  {
    this.busy = busy;
    this.composer.setBusy(busy);
    if (!busy) this.composer.focus();
  }

  private setStatus(text: string): void
  {
    this.statusLine.textContent = text;
  }

  private appendStatus(text: string): void
  {
    this.statusLine.textContent += text;
  }
}
