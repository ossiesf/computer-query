// The input box: Enter to send, Shift+Enter for a new line, ↑/↓ for previously sent messages,
// and the slash-command menu.
import { suggestionsFor, type Suggestion } from "../commands";
import { HistoryCursor } from "../inputHistory";
import { el } from "./dom";

export interface ComposerElements
{
  form: HTMLFormElement;
  input: HTMLTextAreaElement;
  menu: HTMLUListElement;
  sendButton: HTMLButtonElement;
}

export class Composer
{
  private items: Suggestion[] = [];
  private active = 0;
  private readonly history: HistoryCursor;

  constructor(
    private readonly ui: ComposerElements,
    private readonly notes: () => readonly string[],
    sentMessages: () => readonly string[],
    private readonly onSubmit: (text: string) => void,
  )
  {
    this.history = new HistoryCursor(sentMessages);
    ui.form.addEventListener("submit", (e) =>
    {
      e.preventDefault();
      this.submit();
    });
    ui.input.addEventListener("input", () =>
    {
      this.history.reset(); // typing ends history browsing
      this.active = 0;
      this.updateMenu();
    });
    ui.input.addEventListener("focus", () => this.updateMenu());
    ui.input.addEventListener("blur", () => this.hideMenu());
    ui.input.addEventListener("keydown", (e) => this.onKeydown(e));
  }

  focus(): void
  {
    this.ui.input.focus();
  }

  /** While busy, Send is disabled. (Stopping a reply is done from the reply itself.) */
  setBusy(busy: boolean): void
  {
    this.ui.sendButton.disabled = busy;
  }

  private submit(): void
  {
    const text = this.ui.input.value.trim();

    if (!text || this.ui.sendButton.disabled) return;
    this.ui.input.value = "";
    this.history.reset();
    this.hideMenu();
    this.onSubmit(text);
  }

  private onKeydown(e: KeyboardEvent): void
  {
    const menuOpen = !this.ui.menu.hidden && this.items.length > 0;

    if (menuOpen)
    {
      switch (e.key)
      {
        case "ArrowDown":
          e.preventDefault();
          this.active = (this.active + 1) % this.items.length;

          return this.updateMenu();
        case "ArrowUp":
          e.preventDefault();
          this.active = (this.active - 1 + this.items.length) % this.items.length;

          return this.updateMenu();
        case "Tab":
          e.preventDefault();

          return this.accept({ run: false });
        case "Escape":
          e.preventDefault();

          return this.hideMenu();
        case "Enter":
          if (e.shiftKey) return;
          e.preventDefault();

          return this.accept({ run: true });
      }
    }

    if (e.key === "Enter" && !e.shiftKey)
    {
      e.preventDefault();
      this.submit();

      return;
    }

    // ↑ on the first line / ↓ on the last line browse sent messages; elsewhere they move the cursor as usual.
    if (e.key === "ArrowUp" && !hasModifier(e) && this.caretOnFirstLine())
    {
      const older = this.history.older(this.ui.input.value);

      if (older !== null)
      {
        e.preventDefault();
        this.showFromHistory(older);
      }
    }
    else if (e.key === "ArrowDown" && !hasModifier(e) && this.caretOnLastLine() && this.history.browsing)
    {
      e.preventDefault();
      this.showFromHistory(this.history.newer() ?? "");
    }
  }

  private showFromHistory(text: string): void
  {
    this.ui.input.value = text;
    this.ui.input.setSelectionRange(text.length, text.length);
    this.hideMenu(); // a recalled "/command" shouldn't open the menu and capture the next ↑
  }

  private caretOnFirstLine(): boolean
  {
    const { value, selectionStart, selectionEnd } = this.ui.input;

    return selectionStart === selectionEnd && !value.slice(0, selectionStart).includes("\n");
  }

  private caretOnLastLine(): boolean
  {
    const { value, selectionStart, selectionEnd } = this.ui.input;

    return selectionStart === selectionEnd && !value.slice(selectionEnd).includes("\n");
  }

  /** Puts the highlighted suggestion in the input; runs it if it needs no argument. */
  private accept({ run }: { run: boolean }): void
  {
    const suggestion = this.items[this.active];

    if (!suggestion) return;
    this.ui.input.value = suggestion.insert;
    this.ui.input.setSelectionRange(suggestion.insert.length, suggestion.insert.length);
    this.active = 0;
    if (run && suggestion.runOnEnter) this.submit();
    else this.updateMenu(); // e.g. "/forget " now lists the notes
  }

  private updateMenu(): void
  {
    this.items = suggestionsFor(this.ui.input.value, this.notes());
    if (this.items.length === 0) return this.hideMenu();
    this.active = Math.min(this.active, this.items.length - 1);

    const { menu, input } = this.ui;

    menu.textContent = "";
    this.items.forEach((item, i) => menu.append(this.menuItem(item, i)));
    menu.hidden = false;
    input.setAttribute("aria-expanded", "true");
    input.setAttribute("aria-activedescendant", `cmd-option-${this.active}`);
    menu.children[this.active]?.scrollIntoView({ block: "nearest" });
  }

  private menuItem(item: Suggestion, index: number): HTMLLIElement
  {
    const li = el("li");

    li.id = `cmd-option-${index}`;
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", String(index === this.active));
    li.append(el("span", { className: "cmd", text: item.label }), el("span", { className: "desc", text: item.description }));
    if (index === this.active) li.append(el("span", { className: "keys", text: "Tab · Enter" }));
    li.addEventListener("mousedown", (e) => e.preventDefault()); // keep focus in the input
    li.addEventListener("click", () =>
    {
      this.active = index;
      this.accept({ run: true });
    });

    return li;
  }

  private hideMenu(): void
  {
    this.items = [];
    this.ui.menu.hidden = true;
    this.ui.input.setAttribute("aria-expanded", "false");
    this.ui.input.removeAttribute("aria-activedescendant");
  }
}

function hasModifier(e: KeyboardEvent): boolean
{
  return e.shiftKey || e.altKey || e.ctrlKey || e.metaKey;
}
