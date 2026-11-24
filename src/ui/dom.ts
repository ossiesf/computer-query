// Small DOM helpers.

/** Gets an element by ID, or throws if the HTML is missing it. */
export function byId<T extends HTMLElement = HTMLElement>(id: string): T
{
  const element = document.getElementById(id);

  if (!element) throw new Error(`Missing element #${id}`);

  return element as T;
}

export function escapeHtml(text: string): string
{
  return text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

/** Creates an element with optional class and text. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: { className?: string; text?: string } = {},
): HTMLElementTagNameMap[K]
{
  const element = document.createElement(tag);

  if (options.className) element.className = options.className;
  if (options.text !== undefined) element.textContent = options.text;

  return element;
}

/** Triggers a browser download of generated text. */
export function downloadFile(filename: string, contents: string, type: string): void
{
  const link = el("a");

  link.href = URL.createObjectURL(new Blob([contents], { type }));
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

export function today(): string
{
  return new Date().toISOString().slice(0, 10);
}

/** 1234 → "1.2" */
export function seconds(ms: number | null | undefined): string
{
  return ms == null ? "" : (ms / 1000).toFixed(1);
}
