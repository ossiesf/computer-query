// The settings modal. Reads and writes the Settings object directly, then tells the app what changed.
import { SAMPLING_DEFAULTS, SHIP_COMPUTER_PROMPT, SLIDERS } from "../config";
import type { Settings } from "../types";
import { byId, el } from "./dom";

/** What kind of change happened, so the app knows what to refresh. */
export type SettingsChange = "display" | "model" | "other";

export interface SettingsActions
{
  changed(kind: SettingsChange): void;
  opened(): void;
  closed(): void;
  deleteModel(): void;
  notesChanged(): void;
  exportData(): void;
  importData(file: File): void;
  clearChat(): void;
  resetData(): void;
}

type BooleanSetting = {
  [K in keyof Settings]: Settings[K] extends boolean ? K : never;
}[keyof Settings];

const CHECKBOXES: { id: BooleanSetting; change: SettingsChange }[] = [
  { id: "autoLoad", change: "other" },
  { id: "showReasoning", change: "display" },
  { id: "showLogprobs", change: "display" },
  { id: "showStats", change: "display" },
  { id: "showRequest", change: "display" },
  { id: "styleCanned", change: "other" },
  { id: "styleFix", change: "other" },
  { id: "useNotes", change: "other" },
];

export class SettingsDialog
{
  private readonly dialog = byId<HTMLDialogElement>("settings");
  private readonly openButton = byId<HTMLButtonElement>("settingsButton");

  constructor(
    private readonly settings: () => Settings,
    private readonly notes: () => string[],
    private readonly actions: SettingsActions,
  )
  {
    this.bindOpenClose();
    this.bindModelSection();
    this.buildSliders();
    this.bindSamplingSection();
    this.bindCheckboxes();
    this.bindPromptSection();
    this.bindNotesSection();
    this.bindDataSection();
    this.refresh();
  }

  get isOpen(): boolean
  {
    return this.dialog.open;
  }

  open(scrollTo?: HTMLElement): void
  {
    if (!this.dialog.open) this.dialog.showModal();
    this.openButton.setAttribute("aria-expanded", "true");
    scrollTo?.scrollIntoView({ block: "start" });
    this.actions.opened();
  }

  close(): void
  {
    if (this.dialog.open) this.dialog.close();
  }

  /** Copies current settings into every control (after a reset or import). */
  refresh(): void
  {
    const s = this.settings();

    byId<HTMLSelectElement>("precision").value = s.precision;
    byId<HTMLSelectElement>("styleCheck").value = s.styleCheck;
    byId<HTMLSelectElement>("contextWindow").value = String(s.contextWindow);

    for (const slider of SLIDERS)
    {
      byId<HTMLInputElement>(`slider-${slider.key}`).value = String(s[slider.key]);
      byId(`slider-${slider.key}-value`).textContent = String(s[slider.key]);
    }

    byId<HTMLInputElement>("seed").value = s.seed;
    for (const { id } of CHECKBOXES) byId<HTMLInputElement>(id).checked = s[id];
    byId<HTMLTextAreaElement>("systemPrompt").value = s.systemPrompt;
    this.renderNotes();
  }

  setDeviceInfo(text: string): void
  {
    byId("deviceInfo").textContent = text;
  }

  setStorageInfo(text: string): void
  {
    byId("storageInfo").textContent = text;
  }

  renderNotes(): void
  {
    const list = byId<HTMLOListElement>("notes");

    list.textContent = "";

    const notes = this.notes();

    if (notes.length === 0)
    {
      list.append(el("li", { className: "help", text: "No notes stored." }));

      return;
    }

    notes.forEach((note, index) =>
    {
      const remove = el("button", { className: "small", text: "Delete" });

      remove.addEventListener("click", () =>
      {
        notes.splice(index, 1);
        this.actions.notesChanged();
      });

      const item = el("li");

      item.append(el("span", { text: note }), remove);
      list.append(item);
    });
  }

  // ---------- Binding ----------

  private bindOpenClose(): void
  {
    this.openButton.addEventListener("click", () => (this.dialog.open ? this.close() : this.open()));
    byId("closeSettings").addEventListener("click", () => this.close());
    this.dialog.addEventListener("close", () =>
    {
      this.openButton.setAttribute("aria-expanded", "false");
      this.actions.closed();
    });
    // Clicking the dimmed backdrop (outside the dialog box) closes it.
    this.dialog.addEventListener("mousedown", (e) =>
    {
      const box = this.dialog.getBoundingClientRect();
      const outside = e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom;

      if (outside) this.close();
    });
  }

  private bindModelSection(): void
  {
    const s = this.settings;

    onChange<HTMLSelectElement>("precision", (v) => (s().precision = v as Settings["precision"]), () => this.actions.changed("model"));
    onChange<HTMLSelectElement>("styleCheck", (v) => (s().styleCheck = v as Settings["styleCheck"]), () => this.actions.changed("other"));
    // Both need a reload, which the app does as soon as they change.
    onChange<HTMLSelectElement>("contextWindow", (v) => (s().contextWindow = Number(v)), () => this.actions.changed("model"));
    byId("deleteModelButton").addEventListener("click", () => this.actions.deleteModel());
  }

  private buildSliders(): void
  {
    const container = byId("sliders");

    for (const slider of SLIDERS)
    {
      const row = el("div", { className: "row" });
      const label = el("label");

      label.htmlFor = `slider-${slider.key}`;

      const value = el("span");

      value.id = `slider-${slider.key}-value`;
      label.append(slider.label, " ", value);

      const input = el("input");

      Object.assign(input, { type: "range", id: `slider-${slider.key}`, min: slider.min, max: slider.max, step: slider.step });
      input.addEventListener("input", () =>
      {
        this.settings()[slider.key] = Number(input.value);
        value.textContent = input.value;
        this.actions.changed("other");
      });

      row.append(label, input, el("div", { className: "help", text: slider.help }));
      container.append(row);
    }
  }

  private bindSamplingSection(): void
  {
    onChange<HTMLInputElement>("seed", (v) => (this.settings().seed = v), () => this.actions.changed("other"), "input");
    byId("resetSampling").addEventListener("click", () =>
    {
      Object.assign(this.settings(), SAMPLING_DEFAULTS);
      this.refresh();
      this.actions.changed("other");
    });
  }

  private bindCheckboxes(): void
  {
    for (const { id, change } of CHECKBOXES)
    {
      const box = byId<HTMLInputElement>(id);

      box.addEventListener("change", () =>
      {
        this.settings()[id] = box.checked;
        this.actions.changed(change);
      });
    }
  }

  private bindPromptSection(): void
  {
    onChange<HTMLTextAreaElement>("systemPrompt", (v) => (this.settings().systemPrompt = v), () => this.actions.changed("other"), "input");
    byId("resetPrompt").addEventListener("click", () =>
    {
      this.settings().systemPrompt = SHIP_COMPUTER_PROMPT;
      byId<HTMLTextAreaElement>("systemPrompt").value = SHIP_COMPUTER_PROMPT;
      this.actions.changed("other");
    });
  }

  private bindNotesSection(): void
  {
    const input = byId<HTMLInputElement>("noteInput");
    const add = () =>
    {
      const text = input.value.trim();

      if (!text) return;
      this.notes().push(text);
      input.value = "";
      this.actions.notesChanged();
    };

    byId("addNote").addEventListener("click", add);
    input.addEventListener("keydown", (e) =>
    {
      if (e.key === "Enter")
      {
        e.preventDefault();
        add();
      }
    });
  }

  private bindDataSection(): void
  {
    const fileInput = byId<HTMLInputElement>("importFile");

    byId("exportData").addEventListener("click", () => this.actions.exportData());
    byId("importData").addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () =>
    {
      const file = fileInput.files?.[0];

      if (file) this.actions.importData(file);
      fileInput.value = "";
    });
    byId("clearChat").addEventListener("click", () => this.actions.clearChat());
    byId("resetData").addEventListener("click", () => this.actions.resetData());
  }
}

/** Binds a form control: writes its value into settings, then notifies. */
function onChange<T extends HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
  id: string,
  write: (value: string) => void,
  notify: () => void,
  event: "change" | "input" = "change",
): void
{
  const control = byId<T>(id);

  control.addEventListener(event, () =>
  {
    write(control.value);
    notify();
  });
}
