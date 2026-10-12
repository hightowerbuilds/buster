/**
 * Letter matching for Define — which of the selected word's letters become
 * which letters of the dictionary headword.
 *
 * Letters pair by longest common subsequence, ignoring case and accents, so
 * "Lanterns" gives seven letters to "lantern" and drops its "s"; "cafe" gives
 * all four to "café". Word letters left unmatched fade out; headword letters
 * the word lacks fade in where they belong.
 */

// Intl.Segmenter is ES2022; the project targets ES2020 typings.
type GraphemeSegmenter = { segment(text: string): Iterable<{ segment: string }> };
const Segmenter = (Intl as unknown as { Segmenter?: new (locale: undefined, options: { granularity: "grapheme" }) => GraphemeSegmenter }).Segmenter;
const segmenter = Segmenter ? new Segmenter(undefined, { granularity: "grapheme" }) : null;

/** Split text into user-perceived characters. */
export function graphemes(text: string): string[] {
  return segmenter ? Array.from(segmenter.segment(text), part => part.segment) : Array.from(text);
}

const fold = (letter: string) => letter.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** For each letter of `word`, the index of the headword letter it becomes, or -1. */
export function matchLetters(word: string[], headword: string[]): number[] {
  const a = word.map(fold);
  const b = headword.map(fold);
  // lengths[i][j]: LCS of a[i..] and b[j..].
  const lengths = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lengths[i][j] = a[i] === b[j] ? lengths[i + 1][j + 1] + 1 : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }
  const matched = new Array<number>(a.length).fill(-1);
  for (let i = 0, j = 0; i < a.length && j < b.length;) {
    if (a[i] === b[j]) matched[i++] = j++;
    else if (lengths[i + 1][j] >= lengths[i][j + 1]) i++;
    else j++;
  }
  return matched;
}
