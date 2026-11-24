import { describe, expect, it } from "vitest";
import { parseMarkdown, type Block } from "../../src/markdown";

const text = (t: string) => ({ kind: "text", text: t });
const para = (...inline: unknown[]) => ({ kind: "paragraph", inline });
const kinds = (blocks: Block[]) => blocks.map((b) => b.kind);

describe("parseMarkdown: code", () =>
{
  it("splits prose and fenced code blocks, with the language", () =>
  {
    const blocks = parseMarkdown("Python:\n```python\nfor i in range(5):\n    print(i)\n```\n\nJava:\n```java\nfor (int i = 0; i < 5; i++) {}\n```");

    expect(blocks).toEqual([
      para(text("Python:")),
      { kind: "code", lang: "python", code: "for i in range(5):\n    print(i)", complete: true },
      para(text("Java:")),
      { kind: "code", lang: "java", code: "for (int i = 0; i < 5; i++) {}", complete: true },
    ]);
  });

  // Real failure (Qwen, 2026-11-22): a ``` mentioned in a sentence threw every later fence off by one,
  // so a code block was cut in half and its "# Predict…" comment showed as a heading.
  it("ignores ``` that isn't on its own line, so code blocks stay whole", () =>
  {
    const answer = [
      "Wrap code in ``` fences.",
      "",
      "---",
      "",
      "### **7. Make Predictions**",
      "Use the trained model to predict new data:",
      "",
      "```python",
      "# Predict on a single image",
      "image = x_test[0].reshape(1, 28, 28)",
      "prediction = model.predict(image)",
      "print(\"Predicted digit:\", prediction.argmax())",
      "```",
    ].join("\n");
    const blocks = parseMarkdown(answer);

    expect(kinds(blocks)).toEqual(["paragraph", "rule", "heading", "paragraph", "code"]);
    expect(blocks[2]).toEqual({ kind: "heading", level: 3, inline: [{ kind: "bold", children: [text("7. Make Predictions")] }] });
    expect(blocks[4]).toMatchObject({ lang: "python", complete: true, code: expect.stringMatching(/^# Predict on a single image\n.*argmax\(\)\)$/s) });
  });

  it("handles a code block that is still streaming in", () =>
  {
    expect(parseMarkdown("Example:\n```js\nconst a = 1;")).toEqual([
      para(text("Example:")),
      { kind: "code", lang: "js", code: "const a = 1;", complete: false },
    ]);
  });

  it("keeps a block with no language", () =>
  {
    expect(parseMarkdown("```\nplain\n```")).toEqual([{ kind: "code", lang: "", code: "plain", complete: true }]);
  });

  it("removes list indentation from a code block inside a numbered step", () =>
  {
    const [list] = parseMarkdown("1. Train:\n   ```python\n   model.fit(x)\n   ```");

    expect(list).toMatchObject({ kind: "list", ordered: true, items: [[para(text("Train:")), { kind: "code", code: "model.fit(x)" }]] });
  });

  it("never treats a # comment inside code as a heading", () =>
  {
    expect(parseMarkdown("```python\n# count to 3\nprint(1)\n```")).toEqual([
      { kind: "code", lang: "python", code: "# count to 3\nprint(1)", complete: true },
    ]);
  });
});

describe("parseMarkdown: formatting", () =>
{
  it("renders bold, italic, inline code and line breaks", () =>
  {
    expect(parseMarkdown("**What it shows**: a *loop*\nUse `print(i)`.")).toEqual([
      para(
        { kind: "bold", children: [text("What it shows")] },
        text(": a "),
        { kind: "italic", children: [text("loop")] },
        { kind: "break" },
        text("Use "),
        { kind: "code", text: "print(i)" },
        text("."),
      ),
    ]);
  });

  it("parses lists, quotes, rules and tables", () =>
  {
    const blocks = parseMarkdown("- one\n- **two**\n\n> note\n\n---\n\n| a | b |\n|---|---|\n| 1 | 2 |");

    expect(blocks).toEqual([
      { kind: "list", ordered: false, start: 1, items: [[para(text("one"))], [para({ kind: "bold", children: [text("two")] })]] },
      { kind: "quote", blocks: [para(text("note"))] },
      { kind: "rule" },
      { kind: "table", header: [[text("a")], [text("b")]], rows: [[[text("1")], [text("2")]]] },
    ]);
  });

  it("keeps numbered lists' starting number", () =>
  {
    expect(parseMarkdown("3. third\n4. fourth")[0]).toMatchObject({ kind: "list", ordered: true, start: 3 });
  });

  it("leaves multiplication stars alone, but not stars inside code", () =>
  {
    expect(parseMarkdown("3*4*5 = 60 and 2 * 3 * 4 = 24")).toEqual([para(text("3*4*5 = 60 and 2 * 3 * 4 = 24"))]);
    expect(parseMarkdown("Use `2*3*4` here.")).toEqual([para(text("Use "), { kind: "code", text: "2*3*4" }, text(" here."))]);
    expect(parseMarkdown("```\nx = 2*3*4\n```")[0]).toMatchObject({ code: "x = 2*3*4" });
  });
});

describe("parseMarkdown: safety", () =>
{
  it("keeps HTML-looking text as text (it is never rendered as HTML)", () =>
  {
    const html = "<img src=x onerror=alert(1)>";

    expect(JSON.stringify(parseMarkdown(html))).toContain(html);
    expect(JSON.stringify(parseMarkdown(`Inline ${html} too`))).toContain(html);
  });

  it("shows < > & as typed", () =>
  {
    expect(parseMarkdown("if a < b && c > d")).toEqual([para(text("if a < b && c > d"))]);
  });

  it("only makes http(s) links clickable", () =>
  {
    expect(parseMarkdown("[docs](https://example.com)")).toEqual([para({ kind: "link", href: "https://example.com", children: [text("docs")] })]);
    expect(parseMarkdown("[click](javascript:alert(1))")).toEqual([para(text("click"))]);
  });
});
