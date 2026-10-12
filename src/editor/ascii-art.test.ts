import { describe, expect, it } from "vitest";
import { DecorationSet } from "prosemirror-view";
import { asciiArtDecorations, capLetter } from "./ascii-art";
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

describe("asciiArtDecorations", () => {
  const keys = (doc: ReturnType<typeof parseBlocks>, seen: Set<string>) =>
    asciiArtDecorations(doc, seen).map(decoration => [decoration.from, (decoration.spec as { key: string }).key] as const);

  it("draws Heading 1 and 2 and opens paragraphs on a letter, but leaves other headings and lists alone", () => {
    const doc = parseBlocks("# Title\n\n## Part one\n\n### Smaller\n\nFirst paragraph.\n\n- a list item\n\n“Second” paragraph.\n\n");
    const widgets = keys(doc, new Set());
    expect(widgets.map(([, key]) => key)).toEqual(["ascii-heading:1", "ascii-heading:2", "ascii-cap:F", "ascii-cap:“S"]);
    expect(widgets.map(([from]) => doc.resolve(from).parent.type.name)).toEqual(["heading", "heading", "paragraph", "paragraph"]);
  });

  it("keys a heading by its level, so typing in it keeps its widget", () => {
    const seen = new Set<string>();
    expect(keys(parseBlocks("# Typewri"), seen)).toEqual(keys(parseBlocks("# Typewritten"), seen));
  });

  it("decides once per document and remembers every block it has shown", () => {
    const seen = new Set<string>();
    const doc = parseBlocks("# Heading\n\nAlpha one.\n\nBeta two.");
    const first = asciiArtDecorations(doc, seen);
    expect(asciiArtDecorations(doc, seen)).toBe(first);
    expect([...seen]).toEqual(["h1:Heading", "p:Alpha one.", "p:Beta two."]);
    // The same text parsed again (an undo or assistant edit) is already known.
    asciiArtDecorations(parseBlocks("# Heading\n\nAlpha one.\n\nBeta two.\n\nGamma three."), seen);
    expect([...seen]).toEqual(["h1:Heading", "p:Alpha one.", "p:Beta two.", "p:Gamma three."]);
  });

  it("survives being built into a DecorationSet more than once for the same document", () => {
    const seen = new Set<string>();
    const doc = parseBlocks("# Heading\n\nAlpha one.\n\nBeta two.");
    // DecorationSet.create nulls the entries of the array it is given.
    for (let i = 0; i < 3; i++) expect(DecorationSet.create(doc, [...asciiArtDecorations(doc, seen)]).find()).toHaveLength(3);
    expect(asciiArtDecorations(doc, seen).every(Boolean)).toBe(true);
  });
});
