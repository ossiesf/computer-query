// Copy to the clipboard, with a fallback for pages where the Clipboard API isn't allowed.
import { el } from "./dom";

export async function copyText(text: string): Promise<boolean>
{
  try
  {
    await navigator.clipboard.writeText(text);

    return true;
  }
  catch
  {
    // Older method: works without a secure context (e.g. a file:// page).
    const area = el("textarea");

    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();

    const ok = document.execCommand("copy");

    area.remove();

    return ok;
  }
}

const SVG = "http://www.w3.org/2000/svg";

/** Two overlapping sheets: the back one as an outline, the front one as a rounded rectangle. */
const COPY_ICON = ["M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1", "rect:9,9,13,13,2"];
const CHECK_ICON = ["M20 6 9 17l-5-5"];

/** Builds a 24×24 line icon from path data (or "rect:x,y,w,h,r"), without using innerHTML. */
function icon(shapes: readonly string[]): SVGSVGElement
{
  const svg = document.createElementNS(SVG, "svg");

  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");

  for (const shape of shapes)
  {
    if (shape.startsWith("rect:"))
    {
      const [x, y, width, height, r] = shape.slice(5).split(",");
      const rect = document.createElementNS(SVG, "rect");

      Object.entries({ x, y, width, height, rx: r }).forEach(([k, v]) => rect.setAttribute(k, v));
      svg.append(rect);
    }
    else
    {
      const path = document.createElementNS(SVG, "path");

      path.setAttribute("d", shape);
      svg.append(path);
    }
  }

  return svg;
}

/** A small copy button (an icon of two sheets) that shows a check mark for a moment after a click. */
export function copyButton(getText: () => string, label: string): HTMLButtonElement
{
  const button = el("button", { className: "small copy-btn" });

  button.type = "button";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.append(icon(COPY_ICON));

  button.addEventListener("click", async () =>
  {
    const ok = await copyText(getText());
    const result = ok ? "Copied" : "Couldn't copy";

    // Show the result in the icon and the accessible name, then go back.
    button.replaceChildren(ok ? icon(CHECK_ICON) : document.createTextNode("!"));
    button.title = result;
    button.setAttribute("aria-label", result);

    setTimeout(() =>
    {
      button.replaceChildren(icon(COPY_ICON));
      button.title = label;
      button.setAttribute("aria-label", label);
    }, 1500);
  });

  return button;
}
