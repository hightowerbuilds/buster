/**
 * Shape Apple Dictionary text for the Define opening.
 *
 * DCSCopyTextDefinition returns one plain string, for example:
 *   "lantern | ˈlantərn | noun a lamp with a transparent case … • the light
 *    chamber at the top of a lighthouse. ORIGIN Middle English: …"
 * The headword comes first (American dictionaries follow it with the
 * syllabified form, "lantern lan·tern"), pronunciations sit between pipes, and
 * senses are separated by bullets or numbers. The opening shows the headword, the
 * pronunciation, and the senses; etymology and phrase sections are left out.
 */

export interface ShapedDefinition { headword: string; pronunciation: string; senses: string[] }

const TRAILING_SECTIONS = /\s+(?:ORIGIN|DERIVATIVES|PHRASES|PHRASAL VERBS|USAGE)\b[\s\S]*$/;

export function shapeDefinition(raw: string, fallbackHeadword: string): ShapedDefinition {
  const text = raw.replace(/\s+/g, " ").trim();
  const parts = text.split(" | ");
  let headword = fallbackHeadword;
  let pronunciation = "";
  let body = text;
  if (parts.length >= 3) {
    headword = parts[0].trim() || fallbackHeadword;
    pronunciation = parts.slice(1, -1).join(" | ").trim();
    body = parts[parts.length - 1];
  } else if (parts.length === 2) {
    headword = parts[0].trim() || fallbackHeadword;
    body = parts[1];
  }
  // "lantern lan·tern": the syllabified form belongs with the pronunciation.
  const syllables = headword.match(/^(.+?)\s+(\S*·\S*)$/);
  if (syllables && syllables[2].replace(/·/g, "") === syllables[1].replace(/\s+/g, "")) {
    headword = syllables[1];
    pronunciation = [syllables[2], pronunciation].filter(Boolean).join("  ");
  }
  body = body.replace(TRAILING_SECTIONS, "").trim();
  const senses = body
    .split(/\s+•\s+|\s+(?=\d{1,2} (?=[a-z(]))/)
    .map(sense => sense.trim())
    .filter(Boolean);
  return { headword, pronunciation, senses: senses.length ? senses : [body || text] };
}

/** A definition kept as a note: the headword as its title, then pronunciation, senses, and source. */
export function definitionNote(shaped: ShapedDefinition, source: string): string {
  const lines = [`# ${shaped.headword}`, ""];
  if (shaped.pronunciation) lines.push(`*${shaped.pronunciation}*`, "");
  for (const sense of shaped.senses) {
    // A one-word sense is a label ("noun", "verb"): it heads the senses after it.
    if (!/\s/.test(sense)) lines.push(`*${sense}*`, "");
    else lines.push(`- ${sense}`, "");
  }
  lines.push(`— ${source}`, "");
  return lines.join("\n");
}
