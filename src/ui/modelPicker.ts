// The model menu in the header. Picking a model loads it; there is no separate Load button.
import type { Settings } from "../types";
import { el } from "./dom";

export interface PickerOption
{
  value: Settings["model"];
  label: string;
}

export class ModelPicker
{
  constructor(
    private readonly select: HTMLSelectElement,
    onChange: (value: Settings["model"]) => void,
  )
  {
    select.addEventListener("change", () => onChange(select.value as Settings["model"]));
  }

  setOptions(options: PickerOption[], selected: Settings["model"]): void
  {
    this.select.textContent = "";

    for (const option of options)
    {
      const element = el("option", { text: option.label });

      element.value = option.value;
      this.select.append(element);
    }

    this.select.value = selected;
  }

  setValue(value: Settings["model"]): void
  {
    this.select.value = value;
  }

  setDisabled(disabled: boolean): void
  {
    this.select.disabled = disabled;
  }
}
