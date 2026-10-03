import { createEffect, For, onCleanup, Show } from "solid-js";
import { createFocusTrap } from "../lib/a11y";
import type { PrintingService } from "../lib/printing";
import "../styles/print.css";

export default function PrintDialog(props: { printing: PrintingService }) {
  const printing = props.printing, state = printing.state;
  let dialog!: HTMLFormElement;
  const trap = createFocusTrap(() => dialog, printing.cancel);
  createEffect(() => { if (state.document) trap.activate(); else trap.deactivate(); });
  onCleanup(trap.deactivate);
  return <Show when={state.document}>
    <div class="dirty-close-overlay print-overlay" onClick={printing.cancel}>
      <form ref={dialog} noValidate class="dirty-close-dialog print-dialog" role="dialog" aria-modal="true"
        aria-labelledby="print-title" aria-describedby="print-description" onClick={event => event.stopPropagation()}
        onKeyDown={event => event.stopPropagation()}
        onSubmit={event => { event.preventDefault(); void printing.confirm(); }}>
        <div class="dirty-close-title" id="print-title">Print</div>
        <div class="dirty-close-message" id="print-description">
          <strong>{state.document?.title}</strong>
          <Show when={state.document?.caller === "ai"}><span class="print-requested-by">Requested by the Language Model</span></Show>
          <span class="print-draft-hint">Includes your current draft and unsaved changes.</span>
        </div>
        <fieldset disabled={state.busy || state.loading}>
          <label class="print-field">Destination
            <select aria-label="Print destination" value={state.options.destination === "pdf" ? "pdf" : `printer:${state.options.printerId}`}
              onChange={event => {
                const value = event.currentTarget.value;
                printing.update(value === "pdf" ? { destination: "pdf" } : { destination: "printer", printerId: value.slice(8) });
              }}>
              <For each={state.printers}>{printer => <option value={`printer:${printer.id}`}>{printer.name}{printer.isDefault ? " (default)" : ""}</option>}</For>
              <option value="pdf">Save as PDF</option>
            </select>
          </label>
          <Show when={!state.printers.length && !state.loading && !state.printerError}>
            <p class="print-hint">No printers are installed. You can save a PDF.</p>
          </Show>
          <div class="print-fields">
            <label class="print-field">Copies
              <input aria-label="Copies" type="number" min="1" max="99" step="1" disabled={state.options.destination === "pdf"}
                value={state.options.destination === "pdf" ? 1 : state.options.copies}
                onInput={event => printing.update({ copies: event.currentTarget.valueAsNumber })} />
            </label>
            <label class="print-field">Pages
              <select aria-label="Pages" value={state.options.pages} onChange={event => printing.update({ pages: event.currentTarget.value as "all" | "range" })}>
                <option value="all">All pages</option><option value="range">Page range</option>
              </select>
            </label>
          </div>
          <Show when={state.options.pages === "range"}>
            <div class="print-fields">
              <label class="print-field">First page<input aria-label="First page" type="number" min="1" max="10000" step="1" value={state.options.firstPage}
                onInput={event => printing.update({ firstPage: event.currentTarget.valueAsNumber })} /></label>
              <label class="print-field">Last page<input aria-label="Last page" type="number" min="1" max="10000" step="1" value={state.options.lastPage}
                onInput={event => printing.update({ lastPage: event.currentTarget.valueAsNumber })} /></label>
            </div>
          </Show>
          <div class="print-fields">
            <label class="print-field">Paper size
              <select aria-label="Paper size" value={state.options.paper} onChange={event => printing.update({ paper: event.currentTarget.value as typeof state.options.paper })}>
                <option value="letter">US Letter</option><option value="a4">A4</option><option value="legal">US Legal</option>
              </select>
            </label>
            <label class="print-field">Orientation
              <select aria-label="Orientation" value={state.options.orientation} onChange={event => printing.update({ orientation: event.currentTarget.value as typeof state.options.orientation })}>
                <option value="portrait">Portrait</option><option value="landscape">Landscape</option>
              </select>
            </label>
          </div>
          <Show when={state.options.destination === "printer"}>
            <label class="print-field">Sides
              <select aria-label="Print sides" value={state.options.duplex} onChange={event => printing.update({ duplex: event.currentTarget.value as typeof state.options.duplex })}>
                <option value="one-sided">Single-sided</option><option value="two-sided-long-edge">Double-sided · long edge</option><option value="two-sided-short-edge">Double-sided · short edge</option>
              </select>
            </label>
          </Show>
        </fieldset>
        <Show when={state.loading}><p class="print-hint" role="status">Finding printers…</p></Show>
        <Show when={state.printerError}><p class="print-error" role="alert">{state.printerError} <button type="button" class="print-retry" disabled={state.busy || state.loading} onClick={() => void printing.refreshPrinters()}>Retry</button></p></Show>
        <Show when={state.error}><p class="print-error" role="alert">{state.error}</p></Show>
        <div class="dirty-close-buttons">
          <button type="button" class="dirty-close-btn cancel" disabled={state.busy} onClick={printing.cancel}>Cancel</button>
          <button type="submit" class="dirty-close-btn save" disabled={state.busy || state.loading}>
            {state.busy ? "Preparing…" : state.options.destination === "pdf" ? "Save PDF…" : "Print"}
          </button>
        </div>
      </form>
    </div>
  </Show>;
}
