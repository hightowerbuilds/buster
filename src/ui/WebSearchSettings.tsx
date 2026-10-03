import { invoke } from "@tauri-apps/api/core";
import { createSignal, onMount } from "solid-js";

export function WebSearchSettings() {
  const [key, setKey] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [status, setStatus] = createSignal("Checking saved key…");
  onMount(() => {
    invoke<boolean>("web_search_configured").then(saved => setStatus(saved ? "Search key saved." : "No search key saved."))
      .catch(error => setStatus(String(error)));
  });
  const save = async (event: SubmitEvent) => {
    event.preventDefault();
    if (busy() || !key().trim()) return;
    setBusy(true);
    try {
      await invoke("web_search_save_key", { apiKey: key().trim() });
      setKey(""); setStatus("Search key saved. Ask a chat to search the web to try it.");
    } catch (error) { setStatus(String(error)); }
    finally { setBusy(false); }
  };
  return <section class="ai-settings-section" aria-label="Web search">
    <h3>Web search</h3>
    <p class="ai-settings-desc">Chat can search with Brave and cite source links. Search terms are sent to Brave; results contain titles and snippets. Requires a Brave Search API subscription.</p>
    <form class="ai-settings-row" onSubmit={save}>
      <label class="ai-settings-label" for="web-search-key">Brave Search API key</label>
      <input id="web-search-key" class="ai-input ai-input-key" type="password" autocomplete="off" spellcheck={false}
        value={key()} disabled={busy()} placeholder="Enter a key to save or replace"
        onInput={event => setKey(event.currentTarget.value)} />
      <button type="submit" class="ai-provider-btn" disabled={busy() || !key().trim()}>{busy() ? "Saving…" : "Save search key"}</button>
    </form>
    <p class="ai-settings-desc">Stored in your desktop keyring, separately from chat history. Linux requires an unlocked Secret Service.</p>
    <p role="status" class="ai-settings-desc">{status()}</p>
  </section>;
}
