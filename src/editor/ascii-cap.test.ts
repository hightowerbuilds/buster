import { describe, expect, it } from "vitest";
import { DecorationSet } from "prosemirror-view";
import { asciiCapDecorations, capLetter } from "./ascii-cap";
import { parseBlocks } from "./block-markdown";

describe("capLetter", () => {
  it("takes leading punctuation and the first letter or digit, as ::first-letter does", () => {
    expect(capLetter("Well, undoubtedly")).toBe("W");
    expect(capLetter("  “Quoted” start")).toBe("“Q");
    expect(capLetter("1890 was")).toBe("1");
    expect(capLetter("Élan vital")).toBe("É");
    expect(capLetter("— dash first")).toBeNull();
    expect(capLetter("   ")).toBeNull();
  });
});

describe("asciiCapDecorations", () => {
  const keys = (doc: ReturnType<typeof parseBlocks>, seen: Set<string>) =>
    asciiCapDecorations(doc, seen).map(decoration => [decoration.from, (decoration.spec as { key: string }).key]);

  it("puts one widget at the start of each paragraph that opens on a letter, not headings or lists", () => {
    const doc = parseBlocks("# Title\n\nFirst paragraph.\n\n- a list item\n\n“Second” paragraph.\n\n");
    const widgets = keys(doc, new Set());
    expect(widgets.map(([, key]) => key)).toEqual(["ascii-cap:F", "ascii-cap:“S"]);
    for (const [from] of widgets) expect(doc.resolve(from as number).parent.type.name).toBe("paragraph");
  });

  it("decides once per document and remembers every paragraph it has shown", () => {
    const seen = new Set<string>();
    const doc = parseBlocks("Alpha one.\n\nBeta two.");
    const first = asciiCapDecorations(doc, seen);
    expect(asciiCapDecorations(doc, seen)).toBe(first);
    expect([...seen]).toEqual(["Alpha one.", "Beta two."]);
    // The same text parsed again (an undo or assistant edit) is already known.
    asciiCapDecorations(parseBlocks("Alpha one.\n\nBeta two.\n\nGamma three."), seen);
    expect([...seen]).toEqual(["Alpha one.", "Beta two.", "Gamma three."]);
  });

  it("survives being built into a DecorationSet more than once for the same document", () => {
    const seen = new Set<string>();
    const doc = parseBlocks("Alpha one.\n\nBeta two.");
    // DecorationSet.create nulls the entries of the array it is given.
    for (let i = 0; i < 3; i++) expect(DecorationSet.create(doc, [...asciiCapDecorations(doc, seen)]).find()).toHaveLength(2);
    expect(asciiCapDecorations(doc, seen).every(Boolean)).toBe(true);
  });
});
