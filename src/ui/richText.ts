// Renders an answer's markdown as DOM nodes: headings, paragraphs, lists, quotes, tables,
// rules, code blocks with copy buttons, and inline bold/italic/code/links.
// Text is only ever set with textContent, so model output can never inject HTML.
import { parseMarkdown, type Block, type Inline } from "../markdown";
import { copyButton } from "./clipboard";
import { el } from "./dom";

export function renderRichText(container: HTMLElement, text: string): void
{
  container.textContent = "";
  container.classList.add("md");
  parseMarkdown(text).forEach((block) => container.append(renderBlock(block)));
}

// ---------- Blocks ----------

function renderBlock(block: Block): HTMLElement
{
  switch (block.kind)
  {
    case "paragraph":
      return withInline(el("p", { className: "prose" }), block.inline);

    case "heading":
      // Answers sit inside a chat bubble, so headings are scaled down: h1–h2 → h3, h3–h6 → h4.
      return withInline(el(block.level <= 2 ? "h3" : "h4", { className: "md-heading" }), block.inline);

    case "code":
      return renderCode(block);

    case "list":
    {
      const list = el(block.ordered ? "ol" : "ul");

      if (block.ordered && block.start !== 1) list.setAttribute("start", String(block.start));

      for (const item of block.items)
      {
        const li = el("li");

        item.forEach((child) => li.append(renderBlock(child)));
        list.append(li);
      }

      return list;
    }

    case "quote":
    {
      const quote = el("blockquote");

      block.blocks.forEach((child) => quote.append(renderBlock(child)));

      return quote;
    }

    case "table":
      return renderTable(block.header, block.rows);

    case "rule":
      return el("hr");
  }
}

function renderCode(block: Extract<Block, { kind: "code" }>): HTMLElement
{
  // Header: the language, plus a copy button once the block has finished streaming in.
  const head = el("div", { className: "code-head" });

  head.append(el("span", { text: block.lang || "code" }));
  if (block.complete) head.append(copyButton(() => block.code, `Copy ${block.lang || "code"}`));

  // The code itself.
  const code = el("code", { text: block.code });

  if (block.lang) code.dataset.lang = block.lang;

  const pre = el("pre");
  const wrapper = el("div", { className: "code-block" });

  pre.append(code);
  wrapper.append(head, pre);

  return wrapper;
}

function renderTable(header: Inline[][], rows: Inline[][][]): HTMLElement
{
  const table = el("table");
  const headRow = el("tr");

  header.forEach((cell) => headRow.append(withInline(el("th"), cell)));
  table.append(el("thead"), el("tbody"));
  table.tHead!.append(headRow);

  for (const row of rows)
  {
    const tr = el("tr");

    row.forEach((cell) => tr.append(withInline(el("td"), cell)));
    table.tBodies[0].append(tr);
  }

  // Wide tables scroll sideways instead of stretching the chat.
  const scroller = el("div", { className: "table-scroll" });

  scroller.append(table);

  return scroller;
}

// ---------- Inline ----------

function withInline<T extends HTMLElement>(element: T, parts: Inline[]): T
{
  parts.forEach((part) => element.append(renderInline(part)));

  return element;
}

function renderInline(part: Inline): Node
{
  switch (part.kind)
  {
    case "text":
      return document.createTextNode(part.text);

    case "code":
      return el("code", { className: "inline-code", text: part.text });

    case "bold":
      return withInline(el("strong"), part.children);

    case "italic":
      return withInline(el("em"), part.children);

    case "strike":
      return withInline(el("s"), part.children);

    case "break":
      return el("br");

    case "link":
    {
      const link = withInline(el("a"), part.children);

      // Only http(s) links reach here (see markdown.ts). They open in a new tab, without referrer.
      link.href = part.href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.title = part.href;

      return link;
    }
  }
}
