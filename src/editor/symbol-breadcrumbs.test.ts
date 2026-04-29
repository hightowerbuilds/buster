import { describe, expect, it } from "vitest";
import type { LspDocumentSymbol } from "../lib/ipc";
import { symbolBreadcrumbChain } from "./symbol-breadcrumbs";

function sym(
  name: string,
  depth: number,
  line: number,
  col: number,
  endLine: number,
  endCol: number,
): LspDocumentSymbol {
  return {
    name,
    kind: "function",
    line,
    col,
    start_line: line,
    start_col: col,
    end_line: endLine,
    end_col: endCol,
    selection_line: line,
    selection_col: col,
    depth,
  };
}

describe("symbolBreadcrumbChain", () => {
  it("returns containing symbols from outermost to innermost", () => {
    const chain = symbolBreadcrumbChain([
      sym("method", 1, 3, 2, 8, 3),
      sym("ClassName", 0, 1, 0, 10, 1),
      sym("other", 0, 12, 0, 14, 1),
    ], 5, 4);

    expect(chain.map((item) => item.name)).toEqual(["ClassName", "method"]);
  });

  it("excludes symbols outside the cursor position", () => {
    const chain = symbolBreadcrumbChain([
      sym("before", 0, 1, 0, 2, 0),
      sym("after", 0, 10, 0, 12, 0),
    ], 5, 0);

    expect(chain).toEqual([]);
  });

  it("uses range size as a stable tie-breaker when hierarchy depth is unavailable", () => {
    const chain = symbolBreadcrumbChain([
      sym("inner", 0, 4, 0, 6, 0),
      sym("outer", 0, 1, 0, 10, 0),
    ], 5, 0);

    expect(chain.map((item) => item.name)).toEqual(["outer", "inner"]);
  });
});
