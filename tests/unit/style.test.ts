import { describe, expect, it } from "vitest";
import { findStyleIssues, isRelationshipQuestion, protectCode, removeEmptyCodeBlocks, restoreCode } from "../../src/style";

describe("findStyleIssues", () =>
{
  it.each([
    "Photosynthesis: the process plants use to make glucose.",
    "This system does not form opinions about users.",
    "15% of 80 = 12.",
  ])("passes impersonal text: %s", (text) =>
  {
    expect(findStyleIssues(text)).toEqual([]);
  });

  it.each([
    ["I think it is blue.", 'first-person word "I"'],
    ["Let me know if that helps you, my friend.", 'first-person word "me"'],
    ["I'm not sure.", "first-person word"],
  ])("flags first person: %s", (text, expected) =>
  {
    expect(findStyleIssues(text).join()).toContain(expected);
  });

  it("flags emotional phrases", () =>
  {
    expect(findStyleIssues("Great question! Plants make sugar.").join()).toContain('emotional phrase "Great question"');
  });

  it("does not flag 'I' inside other words", () =>
  {
    expect(findStyleIssues("Iron and iodine are elements.")).toEqual([]);
  });

  it("ignores code: loop variables like i are not first person", () =>
  {
    // The answer that used to fail: a Python and a Java loop.
    const answer = "Python:\n```python\nfor i in range(5):\n    print(i)\n```\nJava:\n```java\nfor (int i = 0; i < 5; i++) {\n    System.out.println(i);\n}\n```";

    expect(findStyleIssues(answer)).toEqual([]);
    expect(findStyleIssues("Use `my_list.append(x)` to add an item.")).toEqual([]);
    expect(findStyleIssues("```js\nconst me = 1;")).toEqual([]); // code block still being written
  });

  it("only treats a capital I as first person", () =>
  {
    expect(findStyleIssues("Option i is a lowercase label.")).toEqual([]);
    expect(findStyleIssues("Here I explain it.")).toEqual(['first-person word "I"']);
  });

  it("still checks prose around code", () =>
  {
    expect(findStyleIssues("I wrote this:\n```py\nprint(1)\n```")).toEqual(['first-person word "I"']);
  });
});

describe("isRelationshipQuestion", () =>
{
  it.each(["How are you?", "do you like me", "Are you my friend?", "I love you"])("matches %s", (text) =>
  {
    expect(isRelationshipQuestion(text)).toBe(true);
  });

  it.each(["How are volcanoes formed?", "What do plants like to eat?"])("ignores %s", (text) =>
  {
    expect(isRelationshipQuestion(text)).toBe(false);
  });
});

describe("protectCode / restoreCode", () =>
{
  const text = "Two loops:\n```py\nfor i in x: pass\n```\nand `i++` in C.";

  it("swaps code for numbered placeholders and puts it back", () =>
  {
    const { prose, blocks } = protectCode(text);

    expect(prose).toBe("Two loops:\n[[CODE_1]]\nand [[CODE_2]] in C.");
    expect(restoreCode(prose, blocks)).toBe(text);
  });

  it("rejects a rewrite that drops, duplicates, or invents a placeholder", () =>
  {
    const { blocks } = protectCode(text);

    expect(restoreCode("Two loops: [[CODE_1]] only.", blocks)).toBeNull();
    expect(restoreCode("[[CODE_1]] [[CODE_1]] [[CODE_2]]", blocks)).toBeNull();
    expect(restoreCode("[[CODE_1]] [[CODE_2]] [[CODE_3]]", blocks)).toBeNull();
  });
});

describe("removeEmptyCodeBlocks", () =>
{
  it("drops an empty block, like the one emitted after reasoning", () =>
  {
    expect(removeEmptyCodeBlocks("```\n\n```\n\nPython:\n```python\nprint(1)\n```")).toBe("Python:\n```python\nprint(1)\n```");
  });

  it("never treats the gap between two real blocks as an empty block", () =>
  {
    const text = "Python:\n```python\nprint(1)\n```\n\n```java\nSystem.out.println(1);\n```";

    expect(removeEmptyCodeBlocks(text)).toBe(text);
  });

  it("leaves text without empty blocks untouched", () =>
  {
    expect(removeEmptyCodeBlocks("Plain answer.\n\n\nWith gaps.")).toBe("Plain answer.\n\n\nWith gaps.");
  });
});
