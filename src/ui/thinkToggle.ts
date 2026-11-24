// The Think button next to Send: one click turns step-by-step reasoning on or off.
// The button label never changes; a small "on"/"off" label underneath shows the state.

export class ThinkToggle
{
  constructor(
    private readonly button: HTMLButtonElement,
    private readonly stateLabel: HTMLElement,
    onClick: () => void,
  )
  {
    button.addEventListener("click", onClick);
  }

  /**
   * `on` is the saved setting; `supported` is whether the model in use can reason (only Qwen3 can).
   * The button is never disabled: clicking it with an unsupported model switches to one that supports it.
   */
  update(on: boolean, supported: boolean, modelName: string): void
  {
    this.button.setAttribute("aria-pressed", String(on));
    this.stateLabel.textContent = on ? "on" : "off";
    this.button.title = on
      ? supported
        ? "Reasoning step by step before answering (slower, often more accurate). Click to turn off."
        : `${modelName} can't reason step by step. Load a Qwen3 model to use Think, or click to turn it off.`
      : supported
        ? "Answer immediately. Click to reason step by step first."
        : `${modelName} can't reason step by step. Click to switch to Qwen3 1.7B, which can.`;
  }
}
