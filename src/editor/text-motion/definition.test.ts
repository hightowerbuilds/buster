import { describe, expect, it } from "vitest";
import { definitionNote, shapeDefinition } from "./definition";

describe("shapeDefinition", () => {
  it("splits headword, pronunciation, and senses and leaves out etymology", () => {
    const shaped = shapeDefinition(
      "lantern | ˈlantərn | noun a lamp with a transparent case protecting the flame. • the light chamber at the top of a lighthouse. ORIGIN Middle English: from Old French lanterne.",
      "lantern");
    expect(shaped).toEqual({
      headword: "lantern", pronunciation: "ˈlantərn",
      senses: ["noun a lamp with a transparent case protecting the flame.", "the light chamber at the top of a lighthouse."],
    });
  });

  it("moves the syllabified headword into the pronunciation", () => {
    const shaped = shapeDefinition("lantern lan·tern | ˈlan(t)ərn | noun a lamp with a transparent case.", "lantern");
    expect(shaped.headword).toBe("lantern");
    expect(shaped.pronunciation).toBe("lan·tern  ˈlan(t)ərn");
  });

  it("splits numbered senses", () => {
    const shaped = shapeDefinition("tide | tʌɪd | noun 1 the alternate rising and falling of the sea. 2 a powerful surge of feeling.", "tide");
    expect(shaped.senses).toEqual(["noun", "1 the alternate rising and falling of the sea.", "2 a powerful surge of feeling."]);
  });

  it("falls back to the selected word and raw text for unfamiliar formats", () => {
    expect(shapeDefinition("A plain gloss with no pipes.", "gloss")).toEqual({ headword: "gloss", pronunciation: "", senses: ["A plain gloss with no pipes."] });
  });
});

describe("definitionNote", () => {
  it("keeps the headword, pronunciation, labels, senses, and source", () => {
    expect(definitionNote({ headword: "lantern", pronunciation: "| ˈlan(t)ərn |", senses: ["noun", "a lamp with a transparent case.", "the light chamber of a lighthouse."] }, "New Oxford American Dictionary"))
      .toBe("# lantern\n\n*| ˈlan(t)ərn |*\n\n*noun*\n\n- a lamp with a transparent case.\n\n- the light chamber of a lighthouse.\n\n— New Oxford American Dictionary\n");
  });
});
