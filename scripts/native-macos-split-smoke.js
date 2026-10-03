// Inject only into a disposable build whose identifier contains ".parity-smoke".
// Two launches exercise real native controls, editing, session save and restore.
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
  const reportPath = `${notes.root}/native-macos-split-smoke-result.json`;
  const visible = () => [...document.querySelectorAll('.tab-content')].filter(node => node.getAttribute('aria-hidden') === 'false');
  const tabs = () => [...document.querySelectorAll('.tab-bar [role="tab"]')];
  const editor = () => document.querySelector('.tab-content.is-active .block-prose');
  const activeId = () => document.querySelector('.tab-content.is-active')?.id.replace('content-', '');
  const footer = text => [...document.querySelectorAll('.footer-nav button')].find(button => button.textContent === text).click();
  const key = (target, name, code, modifiers = {}) => {
    for (const type of ['keydown', 'keyup']) target.dispatchEvent(new KeyboardEvent(type, { key: name, code, ...modifiers, bubbles: true, cancelable: true }));
  };
  let previous;
  try { previous = JSON.parse((await ipc('read_file', { path: reportPath })).content); } catch { /* First launch. */ }
  try {
    await wait(() => document.querySelector('.footer-nav'), 'workspace initialization');
    assert(navigator.platform.startsWith('Mac'), 'Running in native macOS WebKit');
    if (previous?.ok && previous.phase === 1) {
      await wait(() => visible().length === 2 && document.querySelector('.split-view-divider'), 'split restored');
      const session = await ipc('load_session');
      assert(session.split_view.leftTabId === previous.firstId && session.split_view.rightTabId === 'settings_tab', 'Native session preserves both pane IDs');
      assert(Math.abs(session.split_view.ratio - 0.63) < 0.000001 && activeId() === 'settings_tab', 'Pane widths and Settings focus survive restart');
      const first = document.querySelector(`#content-${previous.firstId} .block-prose`);
      assert(first.textContent.includes('Left note — café 👋'), 'Left note restores beside Settings');
      document.getElementById(`tab-${previous.secondId}`).click();
      await wait(() => editor()?.textContent.includes('Right note — déjà 📝'), 'second note restored');
      assert(visible().some(node => node.contains(first)), 'Selecting another tab keeps the left note visible');
      document.getElementById('tab-settings_tab').click();
      document.querySelector('[aria-label="Close Settings"]').click();
      assert(visible().length === 1 && activeId() === previous.firstId, 'Closing Settings expands the surviving note');
      while (tabs().length) {
        const before = tabs().length;
        key(document.querySelector('.ide-container'), 'w', 'KeyW', { metaKey: true });
        await wait(() => tabs().length < before, 'close clean tab');
      }
      assert(!!document.querySelector('.welcome-screen'), 'Closing all tabs returns to the spinning B');
    } else {
      assert(!tabs().length, 'Fresh isolated workspace');
      footer('New Note'); const first = await wait(editor, 'first note'); const firstId = activeId();
      first.focus(); document.execCommand('insertText', false, 'Left note — café 👋');
      footer('New Note'); const second = await wait(() => editor() !== first && editor(), 'second note'); const secondId = activeId();
      second.focus(); document.execCommand('insertText', false, 'Right note — déjà 📝');
      document.getElementById(`tab-${firstId}`).click();
      document.querySelector('.split-view-toggle').click();
      assert(visible().length === 2 && visible()[0].contains(first) && visible()[1].contains(second), 'Split View shows two existing editors side by side');
      const a = visible()[0].getBoundingClientRect(), b = visible()[1].getBoundingClientRect();
      assert(a.width > 200 && b.width > 200 && Math.abs(a.right - b.left) < 2 && a.top === b.top, 'Native pane geometry is adjacent and readable');
      await wait(() => document.activeElement === second, 'split activation focus');
      first.focus(); getSelection().selectAllChildren(first.querySelector('p'));
      document.dispatchEvent(new Event('selectionchange')); await delay(50);
      const bold = document.querySelector('[aria-label="Bold"]');
      bold.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); bold.click();
      await wait(() => first.querySelector('strong'), 'left note bold');
      assert(!second.querySelector('strong') && activeId() === firstId, 'Formatting targets the focused pane');
      key(first, 'z', 'KeyZ', { metaKey: true }); await wait(() => !first.querySelector('strong'), 'undo');
      second.focus(); getSelection().collapse(second.querySelector('p'), second.querySelector('p').childNodes.length);
      document.execCommand('insertText', false, ' edited'); await delay(100);
      assert(second.textContent.includes('📝 edited') && !first.textContent.includes('edited'), 'Editing the right pane leaves the left text unchanged');
      footer('Settings'); await wait(() => document.querySelector('#content-settings_tab .settings-tab'), 'Settings beside note');
      assert(visible().length === 2 && visible()[0].contains(first) && !visible().some(node => node.contains(second)), 'Settings replaces only the focused pane');
      const settingsControl = document.querySelector('#content-settings_tab button'); settingsControl.focus();
      await delay(50);
      assert(document.activeElement === settingsControl && activeId() === 'settings_tab', 'Settings controls retain focus');
      const select = document.querySelector('[aria-label="Right pane tab"]');
      select.value = secondId; select.dispatchEvent(new Event('change', { bubbles: true }));
      assert(visible()[1].contains(second) && second.textContent.includes('📝 edited'), 'Pane selector restores the same editor and draft');
      footer('Settings');
      const divider = document.querySelector('.split-view-divider');
      const bounds = document.querySelector('.tab-viewport').getBoundingClientRect();
      divider.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 7, button: 0, bubbles: true, cancelable: true }));
      window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 7, clientX: bounds.left + bounds.width * 0.63 }));
      window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7 }));
      assert(divider.getAttribute('aria-valuenow') === '63' && document.body.style.cursor !== 'col-resize', 'Dragging resizes panes and releases the pointer');
      document.querySelector('.split-view-toggle').click();
      assert(visible().length === 1 && activeId() === 'settings_tab', 'Single View keeps the current tab');
      document.getElementById(`tab-${firstId}`).click(); await delay(100);
      const bar = document.querySelector('.tab-bar'), barRect = bar.getBoundingClientRect();
      const measure = document.createElement('canvas').getContext('2d');
      let offset = 0;
      for (const tab of tabs().slice(0, -1)) {
        measure.font = '11px "JetBrains Mono", Menlo, Monaco, Consolas, monospace';
        const iconWidth = measure.measureText('#').width;
        measure.font = '13px "Lato", sans-serif';
        const name = tab.textContent.replace(' (unsaved)', '').trim();
        offset += 52 + iconWidth + measure.measureText((tab.textContent.includes('(unsaved)') ? '• ' : '') + name).width;
      }
      bar.dispatchEvent(new MouseEvent('contextmenu', { clientX: barRect.left + offset + 12, clientY: barRect.top + 18, bubbles: true, cancelable: true }));
      const alongside = await wait(() => [...document.querySelectorAll('[role="menuitem"]')].find(button => button.textContent === 'Open Alongside'), 'tab context menu');
      alongside.click();
      assert(visible().length === 2 && visible()[0].contains(first) && activeId() === 'settings_tab', 'Open Alongside joins the chosen tab to the current note');
      document.querySelector('.split-view-divider').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true }));
      // Restore the exact width used above through a final pointer drag.
      const resize = document.querySelector('.split-view-divider');
      resize.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 8, button: 0, bubbles: true, cancelable: true }));
      window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 8, clientX: bounds.left + bounds.width * 0.63 }));
      window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 8 }));
      await delay(1800);
      const paths = [firstId, secondId].map(id => `${notes.root}/${document.getElementById(`tab-${id}`).textContent.replace(' (unsaved)', '').trim()}`);
      const text = await Promise.all(paths.map(async path => (await ipc('read_file', { path })).content));
      assert(text[0].includes('Left note — café 👋') && text[1].includes('Right note — déjà 📝 edited'), 'Both panes autosave independently through native storage');
      previous = { firstId, secondId };
    }
    const result = { ...previous, ok: true, phase: previous?.phase === 1 ? 2 : 1, checks };
    try { await ipc('create_file', { path: reportPath }); } catch { /* Existing report. */ }
    await ipc('write_file', { path: reportPath, content: JSON.stringify(result, null, 2) });
    key(window, 'q', 'KeyQ', { metaKey: true });
  } catch (error) {
    const result = { ok: false, checks, error: String(error), stack: error.stack,
      activeTab: activeId(), activeElement: document.activeElement?.outerHTML,
      selection: getSelection()?.toString(), visible: visible().map(node => ({ id: node.id, html: node.innerHTML })) };
    try { await ipc('create_file', { path: reportPath }); } catch { /* Existing report. */ }
    await ipc('write_file', { path: reportPath, content: JSON.stringify(result, null, 2) });
  }
})();
