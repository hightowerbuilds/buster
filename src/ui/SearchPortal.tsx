import { For, Show, createEffect, createSignal } from "solid-js";
import { useBuster } from "../lib/buster-context";
import "../styles/search-portal.css";

export default function SearchPortal(props: { portalId: string }) {
  const { search, commands, store } = useBuster();
  const portal = () => search.portals[props.portalId];
  const [query, setQuery] = createSignal("");
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  createEffect(() => setQuery(portal()?.query ?? ""));
  const sourceName = () => store.tabs.find(tab => tab.id === portal()?.source?.tabId)?.name ?? "Closed note";
  async function run(command: string, extra: Record<string, unknown> = {}) {
    if (busy()) return;
    setBusy(true); setError("");
    try {
      const result = await commands.dispatch({ requestId: crypto.randomUUID(), command, args: { portalId: props.portalId, ...extra } }, "user");
      if (!result.ok) setError(result.error.message);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  return <Show when={portal()} fallback={<section class="search-portal">This search portal is closed.</section>}>{item =>
    <section class="search-portal" aria-label="Search portal" aria-busy={busy()}>
      <header><h2>Search portal</h2><button disabled={busy()} onClick={() => void run("search portal close")}>Close</button></header>
      <p class="search-portal-scope"><strong>Open notes</strong> · Searches current text, including unsaved changes. Nothing leaves this app.</p>
      <p class="search-portal-muted">Model and web search will arrive with the AI connection workflow.</p>
      <Show when={item().source}>
        <div class="search-portal-source"><span>Opened from {sourceName()}</span><button disabled={busy()} onClick={() => void run("search source")}>Return to source</button></div>
        <Show when={item().source?.text}><details><summary>Selected context · used only to fill the query</summary><blockquote>{item().source!.text}</blockquote></details></Show>
      </Show>
      <form onSubmit={event => { event.preventDefault(); void run("search query", { query: query() }); }}>
        <label for={`portal-query-${props.portalId}`}>Word or phrase</label>
        <div class="search-portal-query"><input id={`portal-query-${props.portalId}`} data-tab-focus-target="true" type="search" maxLength={256} value={query()}
          onInput={event => setQuery(event.currentTarget.value)} placeholder="Search your open notes" disabled={busy()} />
          <button type="submit" disabled={busy() || !query().trim()}>{busy() ? "Searching…" : "Search"}</button></div>
        <p class="search-portal-muted">Literal phrase, case insensitive, within a single line. Up to 100 matches. Open a note first to include it.</p>
      </form>
      <Show when={error()}><p class="search-portal-error" role="alert">{error()}</p></Show>
      <p role="status" class="search-portal-muted">{item().status === "ready" ? "Ready when you are. Opening this portal does not start a search." :
        `${item().results.length} ${item().results.length === 1 ? "match" : "matches"} in ${item().searchedNotes} searched ${item().searchedNotes === 1 ? "note" : "notes"}.`}</p>
      <Show when={item().status === "completed" && !item().results.length}><p>No matches. Try a shorter phrase or open another note.</p></Show>
      <Show when={item().skippedNotes}><p class="search-portal-muted">{item().skippedNotes} notes are still loading and were skipped. Wait for them to open, then search again.</p></Show>
      <Show when={item().truncated}><p class="search-portal-muted">Search reached its limit of 100 results or one million characters. Narrow your phrase or close unrelated notes.</p></Show>
      <ol class="search-portal-results"><For each={item().results}>{hit => {
        const stale = () => search.stale(hit.target);
        return <li><div class="search-portal-result-heading"><strong>{hit.name}</strong><span>Line {hit.target.range.anchor.line + 1}</span></div>
          <pre tabindex="0">{hit.passage.text}</pre>
          <Show when={stale()}><p class="search-portal-muted">This note changed or closed. Search again to open the match or start a review.</p></Show>
          <div class="search-portal-buttons"><button disabled={busy() || stale()} onClick={() => void run("search source", { resultId: hit.id })}>Open match</button>
            <button disabled={busy()} onClick={() => void run("search keep", { resultId: hit.id })}>{hit.keptTabId ? "Open kept note" : "Keep as note"}</button>
            <button disabled={busy() || stale()} onClick={() => void run("search review", { resultId: hit.id })}>AI review…</button></div>
        </li>;
      }}</For></ol>
      <p class="search-portal-muted">Search results are temporary. Keep a passage as a note to retain it. AI review opens a separate review; generation needs a connected provider and an explicit request.</p>
    </section>
  }</Show>;
}
