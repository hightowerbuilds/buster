// Inject only into a disposable build whose identifier contains ".parity-smoke".
// All output is PDF. Only the model transport and save-location picker are faked.
void (async () => {
  const checks = [], jobs = [], replies = [], sends = [];
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const wait = async (fn, label) => {
    for (let i = 0; i < 1000; i++) { const value = await fn(); if (value) return value; await delay(50); }
    throw Error(`Timed out: ${label}`);
  };
  const assert = (ok, label) => { if (!ok) throw Error(label); checks.push(label); };
  const original = window.__TAURI_INTERNALS__.invoke;
  const ipc = (command, args = {}) => original(command, args);
  const notes = await ipc('initialize_notes_workspace');
  if (!notes.root.includes('/com.lukehightower.buster.parity-smoke')) throw Error('Requires isolated test storage');
  let outputName = 'portrait-all';
  // The disposable JS bundle routes invoke through this hook. Tauri's real
  // internals are read-only; production assets never contain this routing.
  window.__PRINT_SMOKE_INVOKE__ = (command, args, options) => {
    if (command === 'plugin:dialog|save') return Promise.resolve(`${notes.root}/${outputName}.pdf`);
    if (command === 'assistant_status') return Promise.resolve({ installed: true, loggedIn: true, version: 'native-smoke', authMethod: 'claude.ai', subscription: null, detail: null });
    if (command === 'assistant_reset' || command === 'assistant_interrupt') return Promise.resolve();
    if (command === 'local_models') return Promise.resolve({ models: [] });
    if (command === 'assistant_send') { sends.push(args.request); return Promise.resolve(); }
    if (command === 'assistant_tool_result') { replies.push(args); return Promise.resolve(); }
    if (command === 'print_document') {
      if (args.request.options.destination !== 'pdf') throw Error('Smoke test must never send a physical print job');
      jobs.push(args.request);
    }
    return original(command, args, options);
  };
  const reportPath = `${notes.root}/native-macos-print-smoke-result.json`;
  const dialog = () => document.querySelector('.print-dialog');
  const button = label => document.querySelector(`[aria-label="${label}"]`);
  const select = (label, value) => {
    const element = button(label); element.value = value; element.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const input = (label, value) => {
    const element = button(label); element.value = String(value); element.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const key = (target, name, code, modifiers = {}) => {
    for (const type of ['keydown', 'keyup']) target.dispatchEvent(new KeyboardEvent(type, { key: name, code, ...modifiers, bubbles: true, cancelable: true }));
  };
  const readyDialog = async () => {
    await wait(() => dialog() && !dialog().querySelector('fieldset').disabled, 'print options ready');
    select('Print destination', 'pdf');
  };
  const save = async name => {
    outputName = name;
    dialog().querySelector('button[type="submit"]').click();
    await wait(() => !dialog(), `${name} saved`);
    const file = await ipc('read_binary_file', { path: `${notes.root}/${name}.pdf` });
    assert(atob(file.data_url.split(',')[1]).startsWith('%PDF-'), `${name} is a real native PDF`);
  };
  const emit = (event, payload) => ipc('plugin:event|emit', { event, payload });
  const modelCall = async (callId, tabId) => {
    const before = sends.length;
    const composer = await wait(() => button('Message assistant') && !button('Message assistant').disabled && button('Message assistant'), 'assistant ready');
    composer.value = 'Print this note'; composer.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(() => button('Send') && !button('Send').disabled, 'Send enabled'); button('Send').click();
    const request = await wait(() => sends.length > before && sends.at(-1), 'model request');
    assert(request.tools.some(tool => tool.name === 'document_print'), 'Actual model request includes document_print');
    await emit('assistant-tool-call', { conversationId: request.conversationId, channelId: request.channelId, callId, name: 'document_print', input: { tabId } });
    await readyDialog();
    assert(dialog().textContent.includes('Requested by the Language Model'), 'Model opens the same styled confirmation');
    return request;
  };
  const endTurn = request => emit('assistant-event', { conversationId: request.conversationId, channelId: request.channelId,
    kind: 'result', subtype: 'success', isError: false, usage: {} });
  try {
    await wait(() => document.querySelector('.footer-nav'), 'workspace initialization');
    assert(navigator.platform.startsWith('Mac'), 'Running in native macOS WebKit');
    [...document.querySelectorAll('.footer-nav button')].find(element => element.textContent === 'New Note').click();
    const editor = await wait(() => document.querySelector('.tab-content.is-active .block-prose'), 'note editor');
    const tabId = document.querySelector('.tab-content.is-active').id.replace('content-', '');
    const text = 'Print acceptance — café, déjà vu.\n\n' + Array.from({ length: 100 }, (_, i) =>
      `Paragraph ${String(i + 1).padStart(3, '0')}: The quick brown fox jumps over the lazy dog. A note should remain readable across page breaks, with clear margins and all of its current draft included.`).join('\n\n') + '\n\nPRINT END MARKER';
    editor.focus(); document.execCommand('insertText', false, text);
    await delay(100);
    const draft = editor.textContent;
    button('Print current document').click(); await readyDialog();
    assert(dialog().classList.contains('dirty-close-dialog') && dialog().getAttribute('aria-modal') === 'true', 'Print confirmation uses the app modal style');
    assert(jobs.length === 0, 'Opening print never sends a job');
    [...dialog().querySelectorAll('button')].find(element => element.textContent === 'Cancel').click();
    assert(!dialog() && jobs.length === 0, 'User Cancel sends nothing');
    await emit('menu-print', null); await readyDialog();
    key(dialog(), 'Escape', 'Escape');
    assert(!dialog() && jobs.length === 0, 'File Print and Escape use the same cancellable dialog');
    key(document.querySelector('.ide-container'), 'p', 'KeyP', { metaKey: true });
    await readyDialog(); await save('portrait-all');
    assert(jobs.length === 1 && jobs[0].html.includes('PRINT END MARKER'), 'Command-P prints the complete captured draft');
    button('Print current document').click(); await readyDialog();
    select('Pages', 'range'); input('First page', 2); input('Last page', 1);
    dialog().querySelector('button[type="submit"]').click();
    assert(!!dialog().querySelector('[role="alert"]') && jobs.length === 1, 'Invalid range stays in the styled dialog');
    input('Last page', 2); await save('portrait-page-two');
    assert(document.querySelector('.tab-content.is-active .block-prose') === editor && editor.textContent === draft, 'Printing retains the same editor and draft');
    const bumper = document.querySelector('.assistant-bumper');
    if (bumper.getAttribute('aria-expanded') !== 'true') bumper.click();
    const cancelled = await modelCall('model-cancel', tabId);
    assert(!replies.some(reply => reply.callId === 'model-cancel') && jobs.length === 2, 'Model waits for confirmation');
    [...dialog().querySelectorAll('button')].find(element => element.textContent === 'Cancel').click();
    const cancelledReply = await wait(() => replies.find(reply => reply.callId === 'model-cancel'), 'model cancellation reply');
    assert(!cancelledReply.isError && JSON.parse(cancelledReply.content).status === 'cancelled' && jobs.length === 2, 'Model receives cancellation without a job');
    await endTurn(cancelled); await wait(() => button('Send'), 'cancelled model turn finished');
    const confirmed = await modelCall('model-save', tabId);
    select('Paper size', 'a4'); select('Orientation', 'landscape'); await save('landscape-a4');
    const savedReply = await wait(() => replies.find(reply => reply.callId === 'model-save'), 'model save reply');
    assert(!savedReply.isError && JSON.parse(savedReply.content).status === 'saved', 'Model receives native PDF success after confirmation');
    await endTurn(confirmed); await wait(() => button('Send'), 'confirmed model turn finished');
    await modelCall('model-stop', tabId);
    button('Stop').click(); await wait(() => !dialog(), 'Stop cancels pending printing');
    assert(jobs.length === 3, 'Stopping a model request sends no additional job');
    assert(editor.textContent === draft && document.querySelector(`#content-${tabId} .block-prose`) === editor, 'Model printing preserves note content and editor identity');
    const result = { ok: true, checks, root: notes.root, jobs: jobs.map(job => ({ options: job.options, pdfPath: job.pdfPath })),
      pdfs: ['portrait-all', 'portrait-page-two', 'landscape-a4'].map(name => `${notes.root}/${name}.pdf`) };
    await ipc('create_file', { path: reportPath });
    await ipc('write_file', { path: reportPath, content: JSON.stringify(result, null, 2) });
    key(window, 'q', 'KeyQ', { metaKey: true });
  } catch (error) {
    try { await ipc('create_file', { path: reportPath }); } catch { /* Existing report. */ }
    await ipc('write_file', { path: reportPath, content: JSON.stringify({ ok: false, checks, error: String(error), stack: error.stack,
      jobs: jobs.map(job => ({ options: job.options, pdfPath: job.pdfPath })), replies, dialog: dialog()?.outerHTML,
      assistant: document.querySelector('.assistant-sidebar')?.outerHTML, bumper: document.querySelector('.assistant-bumper')?.outerHTML }, null, 2) });
  }
})();
