/**
 * Text motion flow — lays a paragraph's remaining inline runs out again with
 * Pretext, parting the lines around a rectangular opening.
 *
 * Coordinates are relative to the flow's origin: x from the column's left edge,
 * rows counted from the first reflowed line. Lines beside the opening are laid
 * out as two spans (left of the opening, then right of it); a span narrower
 * than `minSpan` is left empty so words never break into slivers.
 */

import {
  layoutNextRichInlineLineRange,
  materializeRichInlineLineRange,
  prepareRichInline,
  type RichInlineCursor,
} from "@chenglou/pretext/rich-inline";
import { prepareWithSegments } from "@chenglou/pretext";

export interface FlowRun { text: string; font: string }
/** Opening in flow coordinates: horizontal extent in px, vertical extent in rows. */
export interface Opening { left: number; right: number; top: number; rows: number }
/** A laid-out word: `start` is its offset in its run's text (-1 if it could not be found there). */
export interface PlacedWord { run: number; text: string; start: number; x: number; row: number }
export interface FlowResult { words: PlacedWord[]; rows: number }
export type MeasureText = (text: string, font: string) => number;

const MAX_ROWS = 10_000;

/**
 * Split text into the pieces that move as one: Pretext's own line-break
 * segments ("Saxe-|Altenburg,", "women|—|misunderstandings", "our[|Pg"), without
 * their whitespace. A word that wraps in one layout and not in another is the
 * same pieces in both, because these are exactly the places Pretext may break.
 * Offsets index into `text`.
 */
export function wordPieces(text: string, font: string): Array<{ start: number; text: string }> {
  const pieces: Array<{ start: number; text: string }> = [];
  let cursor = 0;
  for (const segment of prepareWithSegments(text, font).segments) {
    for (const match of segment.matchAll(/\S+/g)) {
      const start = text.indexOf(match[0], cursor);
      if (start < 0) continue;
      pieces.push({ start, text: match[0] });
      cursor = start + match[0].length;
    }
  }
  return pieces;
}

let measureContext: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null;
/** Canvas width including spaces — the same source Pretext measures with. */
export const canvasMeasure: MeasureText = (text, font) => {
  if (!text) return 0;
  measureContext ??= typeof OffscreenCanvas !== "undefined"
    ? new OffscreenCanvas(1, 1).getContext("2d")
    : document.createElement("canvas").getContext("2d");
  if (!measureContext) return 0;
  measureContext.font = font;
  return measureContext.measureText(text).width;
};

function rowSpans(row: number, width: number, opening: Opening | null, minSpan: number): Array<[number, number]> {
  if (!opening || row < opening.top || row >= opening.top + opening.rows) return [[0, width]];
  const spans: Array<[number, number]> = [];
  if (opening.left >= minSpan) spans.push([0, opening.left]);
  if (width - opening.right >= minSpan) spans.push([opening.right, width]);
  return spans;
}

/** Lay `runs` out in a column of `width`, parting around `opening`. Words keep their run order. */
export function flowAroundOpening(
  runs: FlowRun[], width: number, opening: Opening | null, minSpan: number, measure: MeasureText = canvasMeasure,
): FlowResult {
  const words: PlacedWord[] = [];
  const openingEnd = opening ? opening.top + opening.rows : 0;
  if (!runs.some(run => run.text.trim())) return { words, rows: openingEnd };

  const prepared = prepareRichInline(runs.map(run => ({ text: run.text, font: run.font })));
  // How far into each run's text the laid words have reached, to find each word's offset.
  const consumed = runs.map(() => 0);
  let cursor: RichInlineCursor | undefined;
  let row = 0;
  let lastRow = -1;
  for (; row < MAX_ROWS; row++) {
    let exhausted = false;
    for (const [start, end] of rowSpans(row, width, opening, minSpan)) {
      const range = layoutNextRichInlineLineRange(prepared, end - start, cursor);
      if (!range) { exhausted = true; break; }
      const line = materializeRichInlineLineRange(prepared, range);
      let x = start;
      for (const fragment of line.fragments) {
        x += fragment.gapBefore;
        const font = runs[fragment.itemIndex].font;
        for (const match of fragment.text.matchAll(/\S+/g)) {
          const run = fragment.itemIndex;
          const offset = runs[run].text.indexOf(match[0], consumed[run]);
          if (offset >= 0) consumed[run] = offset + match[0].length;
          words.push({ run, text: match[0], start: offset, x: x + measure(fragment.text.slice(0, match.index), font), row });
        }
        x += fragment.occupiedWidth;
      }
      cursor = range.end;
      lastRow = row;
    }
    if (exhausted) break;
  }
  return { words, rows: Math.max(lastRow + 1, openingEnd) };
}
