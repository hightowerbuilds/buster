import { For, Show, createEffect, createSignal, onCleanup } from "solid-js";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useBuster } from "../lib/buster-context";
import "../styles/speech.css";

const PREFS_KEY = "bustermark-speech-preferences-v1";
function preferences(): { voiceId: string; rate: number; volume: number } {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}");
    return { voiceId: typeof saved.voiceId === "string" ? saved.voiceId : "",
      rate: typeof saved.rate === "number" && saved.rate >= .1 && saved.rate <= 1 ? saved.rate : .5,
      volume: typeof saved.volume === "number" && saved.volume >= 0 && saved.volume <= 1 ? saved.volume : 1 };
  } catch { return { voiceId: "", rate: .5, volume: 1 }; }
}

export default function SpeechDock() {
  const { store, commands, speech } = useBuster();
  const saved = preferences();
  const [voiceId, setVoiceId] = createSignal(saved.voiceId);
  const [rate, setRate] = createSignal(saved.rate);
  const [volume, setVolume] = createSignal(saved.volume);
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  let preview: HTMLDivElement | undefined;
  let spokenWord: HTMLElement | undefined;
  const job = () => speech.state.job;
  const active = () => !!job() && ["starting", "speaking", "paused", "stopping"].includes(job()!.status);
  const target = () => active() ? job()!.target : speech.state.prepared ?? job()?.target;
  const voiceAvailable = () => speech.state.voices.some(voice => voice.id === voiceId());
  const sourceName = () => store.tabs.find(tab => tab.id === target()?.tabId)?.name ?? "Closed note";
  const text = () => target()?.text ?? "";
  const progress = () => {
    const current = job();
    if (!current || !active() || speech.stale(current.target)) return { start: 0, length: 0 };
    return { start: current.start, length: current.length };
  };
  const progressVoice = () => speech.state.voices.find(voice => voice.id === job()?.voiceId)?.name ?? "macOS voice";
  const pendingDifferent = () => active() && speech.state.prepared && JSON.stringify(speech.state.prepared) !== JSON.stringify(job()!.target);
  createEffect(() => {
    const value = { voiceId: voiceId(), rate: rate(), volume: volume() };
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(value)); } catch { /* Playback does not depend on preference storage. */ }
  });
  createEffect(() => {
    const range = progress();
    if (!range.length) return;
    const frame = requestAnimationFrame(() => {
      if (!preview || !spokenWord) return;
      const box = preview.getBoundingClientRect(), word = spokenWord.getBoundingClientRect();
      if (word.top < box.top) preview.scrollTop += word.top - box.top - 8;
      else if (word.bottom > box.bottom) preview.scrollTop += word.bottom - box.bottom + 8;
    });
    onCleanup(() => cancelAnimationFrame(frame));
  });
  async function run(command: string, args: Record<string, unknown> = {}) {
    setError(""); setBusy(true);
    try {
      const result = await commands.dispatch({ requestId: crypto.randomUUID(), command, args }, "user");
      if (!result.ok) setError(result.error.message);
      else {
        const selector = command === "speech read" ? "[data-speech-stop]" : command === "speech pause" || command === "speech resume" ? "[data-speech-toggle]" : command === "speech stop" ? "[data-speech-read]:not(:disabled), [data-speech-refresh]" : "";
        if (selector) requestAnimationFrame(() => document.querySelector<HTMLElement>(selector)?.focus());
      }
    } finally { setBusy(false); }
  }
  async function manageVoices() {
    try { await openUrl("https://support.apple.com/guide/mac-help/change-the-voice-your-mac-uses-to-speak-text-mchlp2290/mac"); }
    catch { setError("Open System Settings → Accessibility → Read & Speak (Spoken Content on older macOS) to manage voices."); }
  }
  const status = () => {
    const current = job();
    if (!current) return "Choose a voice, then read the selection.";
    return ({ starting: "Starting speech…", speaking: `Reading with ${progressVoice()}`, paused: "Paused", completed: "Finished reading", stopped: "Stopped", failed: "Speech failed" })[current.status];
  };
  return <Show when={speech.state.visible}>
    <section class="speech-dock" aria-label="Read selected text aloud">
      <header><strong>Read aloud</strong><span class="speech-source">{sourceName()}</span>
        <button disabled={busy() || !target()} onClick={() => void run("speech source", active() ? { jobId: job()!.id } : {})}>Return to note</button>
        <button disabled={active()} title={active() ? "Stop playback before closing controls" : "Close speech controls"} aria-label="Close speech controls" onClick={() => { speech.hide(); setError(""); }}>×</button>
      </header>
      <div class="speech-options">
        <label class="speech-voice">macOS voice
          <select data-speech-focus value={voiceId()} disabled={active()} onChange={event => setVoiceId(event.currentTarget.value)}>
            <option value="">{speech.state.loading ? "Loading voices…" : "Choose a voice…"}</option>
            <Show when={voiceId() && !voiceAvailable()}><option value={voiceId()} disabled>Previously chosen voice unavailable</option></Show>
            <For each={[...speech.state.voices].sort((a, b) => `${a.language} ${a.name}`.localeCompare(`${b.language} ${b.name}`))}>{voice =>
              <option value={voice.id}>{voice.name} · {voice.language}{voice.quality === 2 ? " · Enhanced" : voice.quality === 3 ? " · Premium" : ""}</option>
            }</For>
          </select>
        </label>
        <label class="speech-slider">Speaking rate
          <input type="range" min="0.1" max="1" step="0.05" value={rate()} disabled={active()} onInput={event => setRate(Number(event.currentTarget.value))} />
          <span><span>Slower</span><span>Faster</span></span>
        </label>
        <label class="speech-slider">Volume {Math.round(volume() * 100)}%
          <input type="range" min="0" max="1" step="0.05" value={volume()} disabled={active()} onInput={event => setVolume(Number(event.currentTarget.value))} />
        </label>
        <div class="speech-buttons">
          <Show when={!active()}><button data-speech-read class="speech-play" disabled={busy() || !target() || !voiceAvailable() || speech.stale(target()!)}
            onClick={() => void run("speech read", { target: target(), voiceId: voiceId(), rate: rate(), volume: volume() })}>Read selection</button></Show>
          <Show when={job()?.status === "speaking"}><button data-speech-toggle disabled={busy()} onClick={() => void run("speech pause", { jobId: job()!.id })}>Pause</button></Show>
          <Show when={job()?.status === "paused"}><button data-speech-toggle disabled={busy()} onClick={() => void run("speech resume", { jobId: job()!.id })}>Resume</button></Show>
          <Show when={active()}><button data-speech-focus data-speech-stop onClick={() => void run("speech stop", { jobId: job()!.id })}>Stop</button></Show>
          <button data-speech-refresh disabled={busy() || speech.state.loading} onClick={() => void run("speech voices list")}>{speech.state.loading ? "Loading…" : "Refresh voices"}</button>
        </div>
      </div>
      <p class="speech-status" role="status">{status()}</p>
      <Show when={error() || speech.state.error || job()?.error}><p class="speech-error" role="alert">{error() || speech.state.error || job()?.error}</p></Show>
      <Show when={text()}><div ref={preview} class="speech-preview" tabindex="0" aria-label="Captured passage; highlighted word is speech progress">
        {text().slice(0, progress().start)}<mark ref={spokenWord}>{text().slice(progress().start, progress().start + progress().length)}</mark>{text().slice(progress().start + progress().length)}
      </div></Show>
      <Show when={target() && speech.stale(target()!)}><p class="speech-hint">The source changed or closed. Playback uses the captured passage; select text again for a new reading. Progress highlighting is hidden.</p></Show>
      <Show when={pendingDifferent()}><p class="speech-hint">Another selection is ready. Stop or finish this reading before playing it.</p></Show>
      <footer><span>Reads the captured text as written. No cloud account required.</span>
        <button onClick={() => void manageVoices()}>Manage macOS voices ↗</button>
      </footer>
      <Show when={!speech.state.loading && !speech.state.voices.length && !speech.state.error}><p class="speech-hint">No voices are available. Add a voice in macOS Accessibility settings, then Refresh voices.</p></Show>
    </section>
  </Show>;
}
