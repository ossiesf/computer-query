import { describe, expect, it } from "vitest";
import { HistoryCursor, MAX_INPUT_HISTORY, addToHistory } from "../../src/inputHistory";

describe("HistoryCursor", () =>
{
  const sent = ["first", "second", "third"];

  it("steps back with ↑ and forward with ↓, restoring the draft at the end", () =>
  {
    const cursor = new HistoryCursor(() => sent);

    expect(cursor.older("half-typed")).toBe("third");
    expect(cursor.older("third")).toBe("second");
    expect(cursor.older("second")).toBe("first");
    expect(cursor.older("first")).toBeNull(); // nothing older; the field keeps "first"
    expect(cursor.newer()).toBe("second");
    expect(cursor.newer()).toBe("third");
    expect(cursor.newer()).toBe("half-typed");
    expect(cursor.browsing).toBe(false);
    expect(cursor.newer()).toBeNull(); // ↓ does nothing when not browsing
  });

  it("does nothing with an empty history", () =>
  {
    expect(new HistoryCursor(() => []).older("")).toBeNull();
  });

  it("reset stops browsing, so the next ↑ starts from the newest again", () =>
  {
    const cursor = new HistoryCursor(() => sent);

    cursor.older("");
    cursor.older("");
    cursor.reset();
    expect(cursor.older("new draft")).toBe("third");
  });
});

describe("addToHistory", () =>
{
  it("skips an exact repeat of the last entry", () =>
  {
    expect(addToHistory(["a", "b"], "b")).toEqual(["a", "b"]);
    expect(addToHistory(["a", "b"], "a")).toEqual(["a", "b", "a"]);
  });

  it("keeps only the most recent entries", () =>
  {
    const long = Array.from({ length: MAX_INPUT_HISTORY }, (_, i) => `m${i}`);
    const next = addToHistory(long, "newest");

    expect(next).toHaveLength(MAX_INPUT_HISTORY);
    expect(next.at(-1)).toBe("newest");
    expect(next[0]).toBe("m1");
  });
});
