// Turns a model's markdown answer into plain data (blocks and inline pieces) for the UI to build
// with DOM nodes. Parsing is done by `marked`'s lexer, which follows CommonMark/GFM: fences only
// count on their own line, so a stray ``` in a sentence can't split code blocks.
// Pure: returns data, never HTML. Model text is never injected as HTML (raw HTML in an answer is
// kept as visible text).
import { marked, type Token, type Tokens } from "marked";

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "bold" | "italic" | "strike"; children: Inline[] }
  | { kind: "link"; href: string; children: Inline[] }
  | { kind: "break" };

export type Block =
  | { kind: "paragraph"; inline: Inline[] }
  | { kind: "heading"; level: number; inline: Inline[] }
  /** `complete` is false while a block is still streaming in (no closing fence yet). */
  | { kind: "code"; lang: string; code: string; complete: boolean }
  | { kind: "list"; ordered: boolean; start: number; items: Block[][] }
  | { kind: "quote"; blocks: Block[] }
  | { kind: "table"; header: Inline[][]; rows: Inline[][][] }
  | { kind: "rule" };

export function parseMarkdown(text: string): Block[]
{
  const tokens = marked.lexer(protectMathStars(text), { gfm: true, breaks: true });

  return toBlocks(tokens);
}

// ---------- Blocks ----------

function toBlocks(tokens: Token[]): Block[]
{
  return tokens.flatMap((token): Block[] =>
  {
    switch (token.type)
    {
      case "paragraph":
        return [{ kind: "paragraph", inline: toInline((token as Tokens.Paragraph).tokens) }];

      case "heading":
      {
        const heading = token as Tokens.Heading;

        return [{ kind: "heading", level: heading.depth, inline: toInline(heading.tokens) }];
      }

      case "code":
      {
        const code = token as Tokens.Code;

        return [{ kind: "code", lang: (code.lang ?? "").trim(), code: code.text, complete: isClosedFence(code.raw) }];
      }

      case "list":
      {
        const list = token as Tokens.List;

        return [{
          kind: "list",
          ordered: list.ordered,
          start: typeof list.start === "number" ? list.start : 1,
          items: list.items.map((item) => toBlocks(item.tokens)),
        }];
      }

      case "blockquote":
        return [{ kind: "quote", blocks: toBlocks((token as Tokens.Blockquote).tokens) }];

      case "table":
      {
        const table = token as Tokens.Table;

        return [{
          kind: "table",
          header: table.header.map((cell) => toInline(cell.tokens)),
          rows: table.rows.map((row) => row.map((cell) => toInline(cell.tokens))),
        }];
      }

      case "hr":
        return [{ kind: "rule" }];

      // Inside list items, plain lines come as "text" tokens rather than paragraphs.
      case "text":
      {
        const t = token as Tokens.Text;

        return [{ kind: "paragraph", inline: t.tokens ? toInline(t.tokens) : [{ kind: "text", text: t.text }] }];
      }

      // Raw HTML is shown as text, never rendered.
      case "html":
        return token.raw.trim() ? [{ kind: "paragraph", inline: [{ kind: "text", text: token.raw.trim() }] }] : [];

      default:
        return []; // "space", link definitions
    }
  });
}

/** A fenced block is complete once its closing fence has arrived (a line of only ``` or ~~~). */
function isClosedFence(raw: string): boolean
{
  const lines = raw.trimEnd().split("\n");

  return lines.length > 1 && /^\s*(`{3,}|~{3,})\s*$/.test(lines.at(-1)!);
}

// ---------- Inline ----------

function toInline(tokens: Token[] = []): Inline[]
{
  return mergeText(tokens.flatMap(inlinePieces));
}

/** Joins neighboring text pieces (escapes and raw bits arrive as separate tokens). */
function mergeText(parts: Inline[]): Inline[]
{
  const merged: Inline[] = [];

  for (const part of parts)
  {
    const last = merged.at(-1);

    if (part.kind === "text" && last?.kind === "text") last.text += part.text;
    else merged.push(part.kind === "text" ? { ...part } : part);
  }

  return merged;
}

function inlinePieces(token: Token): Inline[]
{
  switch (token.type)
  {
    case "strong":
      return [{ kind: "bold", children: toInline((token as Tokens.Strong).tokens) }];

    case "em":
      return [{ kind: "italic", children: toInline((token as Tokens.Em).tokens) }];

    case "del":
      return [{ kind: "strike", children: toInline((token as Tokens.Del).tokens) }];

    case "codespan":
      return [{ kind: "code", text: unescapeEntities((token as Tokens.Codespan).text) }];

    case "br":
      return [{ kind: "break" }];

    case "link":
    {
      const link = token as Tokens.Link;
      const children = toInline(link.tokens);

      // Only web links become clickable; anything else (javascript:, data:…) stays text.
      return /^https?:\/\//i.test(link.href) ? [{ kind: "link", href: link.href, children }] : children;
    }

    case "image":
      return [{ kind: "text", text: (token as Tokens.Image).text }];

    case "text":
    {
      const t = token as Tokens.Text;

      return t.tokens?.length ? toInline(t.tokens) : [{ kind: "text", text: unescapeEntities(t.text) }];
    }

    case "escape":
      return [{ kind: "text", text: (token as Tokens.Escape).text }];

    // Raw HTML (e.g. <b>) is shown as typed.
    case "html":
      return [{ kind: "text", text: token.raw }];

    default:
      return "raw" in token ? [{ kind: "text", text: token.raw }] : [];
  }
}

/** marked escapes &, <, > and quotes in text for HTML output; we set textContent, so undo that. */
function unescapeEntities(text: string): string
{
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

// ---------- Math stars ----------

/**
 * Markdown would read 3*4*5 as 3, italic 4, 5. Escapes a star between two digits, outside code
 * (fenced blocks and `inline code`), so multiplication stays as written.
 */
function protectMathStars(text: string): string
{
  let inFence = false;

  return text
    .split("\n")
    .map((line) =>
    {
      if (/^\s*(`{3,}|~{3,})/.test(line))
      {
        inFence = !inFence;

        return line;
      }

      if (inFence) return line;

      // Odd-numbered pieces are inside `inline code`; leave those alone.
      return line
        .split(/(`[^`]*`)/)
        .map((piece, i) => (i % 2 ? piece : piece.replace(/(\d)\s?\*(?=\s?\d)/g, (m) => m.replace("*", "\\*"))))
        .join("");
    })
    .join("\n");
}
