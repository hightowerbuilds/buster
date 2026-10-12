/**
 * Passage statistics for the Spread menu's Count panel. Words and sentences
 * come from Intl.Segmenter where available (so CJK text counts sensibly),
 * with a whitespace fallback.
 */

export interface PassageStats {
  words: number;
  characters: number;
  charactersNoSpaces: number;
  sentences: number;
  /** Silent reading time at 238 words per minute, in seconds. */
  readingSeconds: number;
}

const READING_WPM = 238;

// Intl.Segmenter is ES2022; the project targets ES2020 typings.
type Segment = { segment: string; isWordLike?: boolean };
type Segmenter = { segment(text: string): Iterable<Segment> };
const SegmenterCtor = (Intl as unknown as { Segmenter?: new (locale: undefined, options: { granularity: "word" | "sentence" }) => Segmenter }).Segmenter;
const wordSegmenter = SegmenterCtor ? new SegmenterCtor(undefined, { granularity: "word" }) : null;
const sentenceSegmenter = SegmenterCtor ? new SegmenterCtor(undefined, { granularity: "sentence" }) : null;

export function passageStats(text: string): PassageStats {
  const characters = Array.from(text).length;
  const charactersNoSpaces = Array.from(text.replace(/\s+/g, "")).length;
  const words = wordSegmenter
    ? Array.from(wordSegmenter.segment(text)).filter(part => part.isWordLike).length
    : (text.match(/\S+/g) ?? []).length;
  const sentences = sentenceSegmenter
    ? Array.from(sentenceSegmenter.segment(text)).filter(part => /[\p{L}\p{N}]/u.test(part.segment)).length
    : text.split(/[.!?]+(?:\s|$)/).filter(part => /[\p{L}\p{N}]/u.test(part)).length;
  return { words, characters, charactersNoSpaces, sentences, readingSeconds: Math.max(1, Math.round((words / READING_WPM) * 60)) };
}

export interface WordUse { word: string; inSelection: number; inNote: number }

function wordsOf(text: string): string[] {
  const found = wordSegmenter
    ? Array.from(wordSegmenter.segment(text)).filter(part => part.isWordLike).map(part => part.segment)
    : text.match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}'’_-]*/gu) ?? [];
  return found.map(word => word.toLocaleLowerCase());
}

/**
 * How often each distinct word of the selection is used, in the selection and
 * across the whole note (case-insensitive), in order of first appearance.
 */
export function wordUses(selection: string, note: string): WordUse[] {
  const inNote = new Map<string, number>();
  for (const word of wordsOf(note)) inNote.set(word, (inNote.get(word) ?? 0) + 1);
  const uses = new Map<string, WordUse>();
  for (const word of wordsOf(selection)) {
    const use = uses.get(word) ?? { word, inSelection: 0, inNote: inNote.get(word) ?? 0 };
    use.inSelection++;
    uses.set(word, use);
  }
  return [...uses.values()];
}

/** "4 sec", "1 min 12 sec", "3 min". */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} sec`;
  const minutes = Math.floor(seconds / 60), rest = seconds % 60;
  return rest ? `${minutes} min ${rest} sec` : `${minutes} min`;
}
