// Inject only into a disposable build whose identifier contains ".parity-smoke".
// Live acceptance for the Assistant sidebar (growth/phases/phase-3.md) on the
// writer's real subscriptions: Claude Code, Codex, and OpenCode each read the
// open notes through BusterMark's tools and edit a note after approval; Claude
// also shows a declined action, a cancelled response, and switching provider.
// Sends small requests to each provider; takes a few minutes.
void (async () => {
  const checks = [];
  const metrics = {};
  const pageErrors = [];
  addEventListener('error', e => pageErrors.push(`${e.message} @ ${e.filename}:${e.lineno}`.slice(0, 600)));
  addEventListener('unhandledrejection', e => pageErrors.push(`rejection: ${e.reason?.stack ?? e.reason}`.slice(0, 600)));
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const wait = async (fn, label, seconds = 10) => {
    for (let i = 0; i < seconds * 10; i++) { const value = await fn(); if (value) return value; await delay(100); }
    throw Error(`Timed out: ${label}`);
  };
  const assert = (ok, label) => { if (!ok) throw Error(label); checks.push(label); };
  const ipc = (cmd, args = {}) => window.__TAURI_INTERNALS__.invoke(cmd, args);
  const notes = await ipc('initialize_notes_workspace');
  if (!notes.root.includes('/com.lukehightower.buster.parity-smoke')) throw Error('Requires isolated test storage');
  const reportPath = `${notes.root}/native-macos-assistant-smoke-result.json`;
  const editor = () => document.querySelector('.tab-content.is-active .block-prose');
  const footer = text => [...document.querySelectorAll('.footer-nav button')].find(button => button.textContent === text).click();
  const key = (target, name, code, modifiers = {}) => {
    for (const type of ['keydown', 'keyup']) target.dispatchEvent(new KeyboardEvent(type, { key: name, code, ...modifiers, bubbles: true, cancelable: true }));
  };
  const sidebar = () => document.querySelector('.assistant-sidebar');
  const input = () => document.querySelector('[data-assistant-input]');
  const pick = (label, value) => {
    const select = document.querySelector(`.assistant-sidebar select[aria-label="${label}"]`);
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const running = () => !!document.querySelector('.assistant-sidebar .as-stop');
  const replies = () => [...document.querySelectorAll('.as-reply .as-text')].map(p => p.textContent);
  const tools = () => [...document.querySelectorAll('.as-tool, .as-approval')];
  const notices = () => [...document.querySelectorAll('.as-notice')].map(n => n.textContent);
  async function send(text) {
    await wait(() => input() && !input().disabled && !running(), 'composer ready', 30);
    input().value = text;
    input().dispatchEvent(new Event('input', { bubbles: true }));
    await wait(() => !document.querySelector('.as-send')?.disabled, 'send enabled');
    document.querySelector('.as-send').click();
    await wait(running, 'response started');
  }
  const finished = (label, seconds = 180) => wait(() => !running(), label, seconds);

  const original = 'The harbor lantern swung over the quiet water.';
  try {
    await wait(() => document.querySelector('.footer-nav'), 'workspace initialization');
    footer('New Note');
    const note = await wait(editor, 'new note');
    note.focus();
    document.execCommand('insertText', false, original);
    await delay(300);
    assert(note.textContent === original, 'A note to work on is open');

    // The sidebar's open state belongs to the active chat; a click while chat history loads can be lost.
    for (let attempt = 0; attempt < 5 && !sidebar(); attempt++) {
      document.querySelector('.assistant-bumper').click();
      for (let i = 0; i < 20 && !sidebar(); i++) await delay(100);
    }
    await wait(() => sidebar() && input() && !input().disabled, 'Language Model sidebar');
    const providers = [...document.querySelectorAll('.assistant-sidebar select[aria-label="Provider"] option')].map(o => o.textContent);
    assert(providers.join(',') === 'Claude,Codex,OpenCode', `The Assistant offers Claude, Codex, and OpenCode (${providers.join(', ')})`);

    for (const provider of ['claude', 'codex', 'opencode']) {
      const name = { claude: 'Claude', codex: 'Codex', opencode: 'OpenCode' }[provider];
      const company = { claude: 'Anthropic', codex: 'OpenAI', opencode: 'OpenCode' }[provider];
      document.querySelector('[aria-label="New chat"]').click();
      await wait(() => input() && !input().disabled && !replies().length && !tools().length, `new chat for ${name}`);
      pick('Provider', provider);
      if (provider === 'claude') pick('Model', 'claude-haiku-5-5');
      if (provider !== 'opencode') pick('Effort', 'low');
      await wait(() => document.querySelector('.as-status-good'), `${name} connected`, 30);
      assert(new RegExp(company).test(document.querySelector('.as-destination').textContent), `${name}: the chat says where messages go (${company})`);
      const started = Date.now();

      // Read: the model looks at the open notes through BusterMark's tools.
      await send('Use the document_list tool to see which notes are open, then tell me how many are open in one short sentence.');
      await finished(`${name} read reply`);
      const listed = tools().find(t => t.querySelector('.as-tool-name')?.textContent === 'document list');
      metrics[provider] = { readMs: Date.now() - started, reply: replies().slice(-1)[0]?.slice(0, 160), notices: notices() };
      assert(!!listed && listed.classList.contains('as-tool-done'), `${name}: calls document list through BusterMark`);
      assert(listed.querySelector('.as-tool-shared')?.textContent === `sent to ${name}`, `${name}: the chat marks what was sent`);
      assert(replies().length > 0, `${name}: answers in the chat (“${metrics[provider].reply}”)`);

      // Edit: a change waits for approval, applies, and undoes in one step.
      await send('In the open note, change the word "lantern" to "lamp". Read it with document_read, then make the change with document_edit.');
      const approval = await wait(() => document.querySelector('.as-approval'), `${name} asks to edit`, 180);
      assert(/Apply \d+ edits?/.test(approval.textContent) && approval.querySelector('del')?.textContent.includes('lantern'), `${name}: shows the edit for approval first`);
      assert(note.textContent === original, `${name}: nothing changes before approval`);
      [...approval.querySelectorAll('button')].find(b => b.textContent === 'Allow').click();
      await wait(() => note.textContent === 'The harbor lamp swung over the quiet water.', `${name} edit applied`, 60);
      assert(true, `${name}: Allow applies the edit to the note`);
      await finished(`${name} edit reply`);
      metrics[provider].editMs = Date.now() - started;
      note.focus();
      key(note, 'z', 'KeyZ', { metaKey: true });
      await wait(() => note.textContent === original, `${name} undo`);
      assert(true, `${name}: Command-Z undoes the edit in one step`);
    }

    // Claude: a declined action, a cancelled response, and switching provider mid-chat.
    document.querySelector('[aria-label="New chat"]').click();
    await wait(() => input() && !input().disabled && !replies().length, 'new chat for denial');
    pick('Provider', 'claude');
    pick('Model', 'claude-haiku-5-5');
    await send('In the open note, change the word "harbor" to "port". Read it with document_read, then use document_edit.');
    const ask = await wait(() => document.querySelector('.as-approval'), 'Claude asks before editing', 180);
    [...ask.querySelectorAll('button')].find(b => b.textContent === 'Deny').click();
    await wait(() => document.querySelector('.as-tool-denied'), 'declined entry');
    await finished('reply after denial');
    assert(note.textContent === original, 'Deny leaves the note unchanged and the chat shows it was declined');

    await send('Write a 600-word poem about lighthouses. Do not use any tools.');
    await delay(1500);
    document.querySelector('.as-stop').click();
    await finished('stop', 10);
    assert(notices().some(text => text === 'Stopped.'), 'Stop ends the response and says so');
    assert(note.textContent === original, 'A stopped response changes nothing');

    pick('Provider', 'codex');
    await wait(() => notices().some(text => /Now answering with Codex/.test(text)), 'switch notice');
    assert(true, 'Switching provider mid-chat says the new one starts fresh');

    const result = { ok: true, checks, metrics };
    try { await ipc('create_file', { path: reportPath }); } catch { /* Existing report. */ }
    await ipc('write_file', { path: reportPath, content: JSON.stringify(result, null, 2) });
    key(window, 'q', 'KeyQ', { metaKey: true });
  } catch (error) {
    const result = { ok: false, checks, metrics, error: String(error), pageErrors,
      transcript: sidebar()?.querySelector('.as-transcript')?.innerText?.slice(-3000), connection: document.querySelector('.as-status')?.title,
      dom: { bumper: !!document.querySelector('.assistant-bumper'), sidebar: !!sidebar(), input: !!input(), disabled: input()?.disabled, setup: document.querySelector('.as-setup')?.textContent } };
    try { await ipc('create_file', { path: reportPath }); } catch { /* Existing report. */ }
    await ipc('write_file', { path: reportPath, content: JSON.stringify(result, null, 2) });
  }
})();
