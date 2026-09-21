import { invoke } from "@tauri-apps/api/core";

export interface SelectionLookupResult {
  query: string;
  definition: string | null;
  source: string;
}

/** Queries installed dictionaries only; selected text never goes to a search service. */
export async function lookupSelection(text: string): Promise<SelectionLookupResult> {
  const query = text.trim();
  if (!query) throw new Error("Select a word or short phrase to look up.");
  if (Array.from(query).length > 256) {
    throw new Error("Look up accepts at most 256 characters. Select a word or short phrase.");
  }
  if (/[\u0000-\u001f\u007f-\u009f]/u.test(query)) {
    throw new Error("Select a word or phrase on one line to look up.");
  }
  return invoke<SelectionLookupResult>("lookup_selection_text", { text: query });
}
