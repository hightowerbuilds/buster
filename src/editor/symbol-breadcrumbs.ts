import type { LspDocumentSymbol } from "../lib/ipc";

function containsPosition(symbol: LspDocumentSymbol, line: number, col: number): boolean {
  const startsBefore =
    symbol.start_line < line || (symbol.start_line === line && symbol.start_col <= col);
  const endsAfter =
    symbol.end_line > line || (symbol.end_line === line && symbol.end_col >= col);
  return startsBefore && endsAfter;
}

function rangeSize(symbol: LspDocumentSymbol): number {
  return (symbol.end_line - symbol.start_line) * 100_000 + (symbol.end_col - symbol.start_col);
}

export function symbolBreadcrumbChain(
  symbols: LspDocumentSymbol[],
  line: number,
  col: number,
): LspDocumentSymbol[] {
  return symbols
    .filter((symbol) => containsPosition(symbol, line, col))
    .sort((a, b) => {
      if (a.depth !== b.depth) return a.depth - b.depth;
      return rangeSize(b) - rangeSize(a);
    });
}
