// Load only in a disposable build whose identifier contains ".parity-smoke".
// Exercises the real WKWebView and native IPC; never sends a model request.
void (async () => {
  const checks = [];
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const wait = async (fn, label) => {
    for (let i = 0; i < 200; i++) { const value = await fn(); if (value) return value; await delay(50); }
    throw Error(`Timed out: ${label}`);
  };
  const assert = (ok, label) => { if (!ok) throw Error(label); checks.push(label); };
  const ipc = (cmd, args = {}) => window.__TAURI_INTERNALS__.invoke(cmd, args);
  const notes = await ipc('initialize_notes_workspace');
  if (!notes.root.includes('/com.lukehightower.buster.parity-smoke')) throw Error('Requires isolated test storage');
  const reportPath = `${notes.root}/native-macos-smoke-result.json`;
  let previous;
  try { previous = JSON.parse((await ipc('read_file', { path: reportPath })).content); } catch { /* First launch. */ }
  const tabs = () => [...document.querySelectorAll('.tab-bar [role="tab"]')];
  const editor = () => document.querySelector('.tab-content.is-active .block-prose');
  const footer = text => [...document.querySelectorAll('.footer-nav button')].find(button => button.textContent === text).click();
  const key = (target, name, code, modifiers = {}) => {
    for (const type of ['keydown', 'keyup']) target.dispatchEvent(new KeyboardEvent(type, { key: name, code, ...modifiers, bubbles: true, cancelable: true }));
  };
  try {
    await wait(() => document.querySelector('.footer-nav'), 'workspace initialization');
    assert(navigator.platform.startsWith('Mac'), 'Running in native macOS WebKit');
    assert(!tabs().length && document.querySelector('.welcome-screen'), 'Empty workspace shows welcome');
    const canvas = await wait(() => {
      const node = document.querySelector('.welcome-ascii canvas');
      return node && getComputedStyle(node).opacity === '1' && node;
    }, 'blackletter ASCII renderer');
    assert(!document.querySelector('.welcome-ascii-fallback'), 'Bundled blackletter font renders the ASCII B');
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const frame = canvas.toDataURL(); await delay(1000);
      assert(frame !== canvas.toDataURL(), 'Old English B animates in WKWebView');
    }
    const { ShaderRenderer } = await import('./background-renderer.js');
    const wgsl = '@fragment fn fs_main(@builtin(position) pos: vec4f) -> @location(0) vec4f { return select(u.paper, u.accent, pos.x > u.resolution.x * 0.5); }';
    const glsl = await ipc('background_compile', { wgsl });
    assert(glsl.startsWith('#version 300 es'), 'Native shader service translates WGSL to GLSL');
    const shaderCanvas = document.createElement('canvas'); shaderCanvas.width = shaderCanvas.height = 64;
    const renderer = new ShaderRenderer(shaderCanvas);
    assert(renderer.setShader(glsl) === null, 'macOS WebGL2 compiles and links the note background');
    renderer.draw({ width: 64, height: 64, time: 0, strength: 1, accent: [0, 0, 1, 1], paper: [0, 1, 0, 1], ink: [1, 1, 1, 1] });
    const green = renderer.readPixel(8, 20), blue = renderer.readPixel(56, 20);
    assert(green[1] === 255 && green[2] === 0 && blue[1] === 0 && blue[2] === 255, 'Shader uniforms produce the expected pixels in native WebKit');
    renderer.dispose();
    const savedChats = await ipc('chat_history_load');
    if (savedChats?.chats.some(chat => chat.draft === 'Mac saved draft: déjà 📝')) {
      if (!previous?.notePath) {
        const entries = await ipc('list_directory', { path: notes.root });
        for (const entry of entries.filter(entry => entry.name.endsWith('.md'))) {
          const note = await ipc('read_file', { path: entry.path });
          if (note.content.includes('Mac writing — café 👋')) { previous = { phase: 1, notePath: entry.path }; break; }
        }
      }
      if (!document.querySelector('.assistant-sidebar')) document.querySelector('.assistant-bumper').click();
      const input = await wait(() => document.querySelector('[data-assistant-input]:not(:disabled)'), 'restored chat');
      assert(input.value === 'Mac saved draft: déjà 📝', 'Unicode chat draft survives a native restart');
      const archive = await ipc('chat_history_load');
      assert(archive.chats.length === 2, 'Both chat conversations survive a native restart');
      const note = await ipc('read_file', { path: previous.notePath });
      assert(note.content.includes('Mac writing — café 👋'), 'Autosaved note survives a native restart');
      const session = await ipc('load_session');
      assert(session.version === 2 && session.tabs.length === 0, 'Version 2 restores the empty tab workspace');
    } else {
      footer('New Note'); const first = await wait(editor, 'first block editor'); const firstId = tabs()[0].id;
      first.focus(); document.execCommand('insertText', false, 'Mac writing — café 👋');
      assert(first.textContent.includes('café 👋'), 'Markdown block editor accepts Unicode text');
      footer('New Note'); await wait(() => editor() && editor() !== first, 'second block editor');
      document.getElementById(firstId).click();
      assert(editor() === first && first.textContent.includes('café 👋'), 'Switching preserves the original editor and text');
      first.focus(); getSelection().selectAllChildren(first.querySelector('p')); document.dispatchEvent(new Event('selectionchange')); await delay(50);
      const bold = document.querySelector('[aria-label="Bold"]'); bold.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); bold.click();
      await wait(() => first.querySelector('strong'), 'bold formatting');
      key(first, 'z', 'KeyZ', { metaKey: true }); await delay(100);
      assert(!first.querySelector('strong') && first.textContent.includes('café 👋'), 'Command-Z undoes formatting in native WebKit');
      footer('Settings'); footer('Settings');
      assert(tabs().filter(tab => tab.id === 'tab-settings_tab').length === 1, 'Settings stays a single tab');
      assert([...document.querySelectorAll('.tab-content.is-active [role="tab"]')].map(tab => tab.textContent.trim()).join(',') === 'Appearances,Hotkeys', 'Settings matches Linux categories');
      assert(!document.querySelector('.writing-format-bar'), 'Settings hides the writing toolbar');
      document.getElementById(firstId).click(); await delay(1800);
      // Flush the normal save shortcut, then close clean tabs through Command-W.
      key(first, 's', 'KeyS', { metaKey: true }); await delay(400);
      const notePath = `${notes.root}/${document.getElementById(firstId).textContent.replace(' (unsaved)', '').trim()}`;
      const disk = await wait(async () => {
        try { const saved = await ipc('read_file', { path: notePath }); return saved.content.includes('Mac writing — café 👋') && saved; }
        catch { return null; }
      }, 'note autosave');
      assert(disk.content.includes('Mac writing — café 👋'), 'Managed note autosaves through native atomic storage');
      while (tabs().length) {
        const before = tabs().length;
        key(document.querySelector('.ide-container'), 'w', 'KeyW', { metaKey: true });
        await wait(() => tabs().length < before, 'Command-W closes a tab');
      }
      assert(document.querySelector('.welcome-screen'), 'Closing the last tab reveals the spinning B without quitting');
      document.querySelector('.assistant-bumper').click();
      const input = await wait(() => document.querySelector('[data-assistant-input]:not(:disabled)'), 'Language Model sidebar');
      input.value = 'Mac saved draft: déjà 📝'; input.dispatchEvent(new Event('input', { bubbles: true }));
      await wait(async () => (await ipc('chat_history_load'))?.chats.some(chat => chat.draft === input.value), 'first chat saved');
      document.querySelector('[aria-label="New chat"]').click();
      await wait(() => !input.disabled && input.value === '', 'second chat');
      input.value = 'Second Mac draft'; input.dispatchEvent(new Event('input', { bubbles: true }));
      await wait(async () => (await ipc('chat_history_load'))?.chats.some(chat => chat.draft === 'Second Mac draft'), 'second chat saved');
      document.querySelector('[aria-label="Chat history"]').click();
      const pick = document.querySelector('.as-chat-row:not(.as-chat-active) .as-chat-pick');
      assert(!!pick, 'Saved chats appear in history'); pick.click();
      await wait(() => input.value === 'Mac saved draft: déjà 📝', 'first draft restored');
      assert(true, 'Switching chats restores independent drafts');
      previous = { notePath };
    }
    const result = { ok: true, phase: previous?.phase === 1 ? 2 : 1, notePath: previous.notePath, checks };
    try { await ipc('create_file', { path: reportPath }); } catch { /* Already exists on restart. */ }
    await ipc('write_file', { path: reportPath, content: JSON.stringify(result, null, 2) });
    window.__smokeResult = result;
    key(window, 'q', 'KeyQ', { metaKey: true });
  } catch (error) {
    const result = { ok: false, checks, error: String(error), stack: error.stack };
    try { await ipc('create_file', { path: reportPath }); } catch { /* Existing report. */ }
    await ipc('write_file', { path: reportPath, content: JSON.stringify(result, null, 2) });
    window.__smokeResult = result;
  }
})();
