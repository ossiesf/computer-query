// The ship's-computer style rules: no first person, no feelings, no flattery. Pure functions.

const RELATIONSHIP_QUESTION =
  /\b(do you (like|love|hate|miss)|are you (my )?(friend|alive|real|conscious|happy|sad|lonely)|how are you|how do you feel|do you have feelings|will you be my|i love you|be my friend)\b/i;

export const CANNED_RELATIONSHIP_REPLY =
  "This system is a software tool and does not have feelings or relationships. Queries on any subject may be entered.";

// A capital "I" only: a lowercase "i" is almost always code (a loop variable) or a typo, not the model speaking.
const FIRST_PERSON_I = /\bI\b/; // also catches I'm, I've, I'll, I'd
const FIRST_PERSON_WORD = /\b(me|my|mine|myself)\b/i;

const EMOTIONAL_PHRASE =
  /\b(happy to help|glad to|i feel|i love|i hope|i'm excited|excited to|delighted|great question|good question|my pleasure|i'm sorry|sorry to hear|feel free)\b/i;

/** Fenced code blocks (including one still being written) and `inline code`. The style rules never apply to code. */
const CODE = /```[\s\S]*?(?:```|$)|`[^`\n]*`/g;

/** Questions that invite a relationship ("how are you?") get a fixed reply instead of a model call. */
export function isRelationshipQuestion(text: string): boolean
{
  return RELATIONSHIP_QUESTION.test(text);
}

/** Returns a plain description of each rule the text breaks; empty means it passes. Code is ignored. */
export function findStyleIssues(text: string): string[]
{
  const prose = text.replace(CODE, " ");
  const issues: string[] = [];
  const firstPerson = prose.match(FIRST_PERSON_I) ?? prose.match(FIRST_PERSON_WORD);

  if (firstPerson) issues.push(`first-person word "${firstPerson[0]}"`);

  const emotional = prose.match(EMOTIONAL_PHRASE);

  if (emotional) issues.push(`emotional phrase "${emotional[0]}"`);

  return issues;
}

/**
 * Swaps each code block for a numbered placeholder ([[CODE_1]], …) so the model can rewrite the
 * prose around it without being able to change the code.
 */
export function protectCode(text: string): { prose: string; blocks: string[] }
{
  const blocks: string[] = [];
  const prose = text.replace(CODE, (block) =>
  {
    blocks.push(block);

    return `[[CODE_${blocks.length}]]`;
  });

  return { prose, blocks };
}

/** Puts the code back. Returns null if the rewrite lost or duplicated any placeholder. */
export function restoreCode(prose: string, blocks: readonly string[]): string | null
{
  let out = prose;

  for (let i = 0; i < blocks.length; i++)
  {
    const placeholder = `[[CODE_${i + 1}]]`;

    if (out.split(placeholder).length !== 2) return null;
    out = out.replace(placeholder, () => blocks[i]);
  }

  return /\[\[CODE_\d+\]\]/.test(out) ? null : out;
}

/**
 * Drops code blocks with nothing in them (small models sometimes emit an empty one after reasoning).
 * Blocks are matched in order, fence to fence, so the gap between two real blocks is never mistaken for one.
 */
export function removeEmptyCodeBlocks(text: string): string
{
  const cleaned = text.replace(CODE, (block) => (/^```[\w+-]*\s*```$/.test(block.trim()) ? "" : block));

  return cleaned === text ? text : cleaned.replace(/\n{3,}/g, "\n\n").trim();
}
