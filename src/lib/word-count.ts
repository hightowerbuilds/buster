// Runs of letters or digits, joined by apostrophes or hyphens ("don't", "well-known"). Markdown
// markers such as #, *, - and > are not letters, so they do not count as words.
const WORD = /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu;

/** Counting is linear; very large buffers are skipped to keep typing responsive. */
export const MAX_COUNTED_CHARS = 2_000_000;

export function countWords(text: string): number {
  let count = 0;
  WORD.lastIndex = 0;
  while (WORD.exec(text)) count++;
  return count;
}

export function wordCountLabel(total: number, selected?: number | null): string {
  const noun = (n: number) => `${n.toLocaleString()} ${n === 1 ? "word" : "words"}`;
  return selected ? `${selected.toLocaleString()} of ${noun(total)}` : noun(total);
}
