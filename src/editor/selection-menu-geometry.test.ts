import { expect, it } from "vitest";
import { selectionMenuPosition } from "./selection-menu-geometry";

it("anchors reversed wrapped selections to visible canvas rows and clamps within narrow panes", () => {
  const rows = [{ bufferLine: 0, startCol: 0, text: "hello " }, { bufferLine: 0, startCol: 6, text: "世界" }];
  expect(selectionMenuPosition({ anchor: { line: 0, col: 8 }, head: { line: 0, col: 1 } }, rows, 0, 240, 300, 22, 8, 50, 220, 82))
    .toEqual({ x: 4, y: 50 });
});
it("places actions above a selection near the bottom and hides when scrolled away", () => {
  const rows = Array.from({ length: 20 }, (_, bufferLine) => ({ bufferLine, startCol: 0, text: "writing" }));
  const range = { anchor: { line: 9, col: 0 }, head: { line: 9, col: 7 } };
  expect(selectionMenuPosition(range, rows, 0, 800, 240, 22, 8, 50, 220, 82)).toEqual({ x: 4, y: 110 });
  expect(selectionMenuPosition(range, rows, 250, 800, 240, 22, 8, 50, 220, 82)).toBeNull();
});
it("does not show actions for collapsed or horizontally offscreen ranges", () => {
  const rows = [{ bufferLine: 0, startCol: 0, text: "x".repeat(200) }];
  for (const [a, b] of [[0, 0], [100, 110]]) {
    expect(selectionMenuPosition({ anchor: { line: 0, col: a }, head: { line: 0, col: b } }, rows, 0, 240, 300, 22, 8, 50, 220, 82)).toBeNull();
  }
});
