// Inject only into a disposable build whose identifier contains ".parity-smoke".
// Exercises the Spread menu (growth/phases/text-motion.md) in the real WKWebView:
// pixel-exact first frame, parting around the opening, exact return, catalog actions.
void (async () => {
  const checks = [];
  const metrics = {};
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const frame = () => new Promise(resolve => requestAnimationFrame(() => resolve()));
  const wait = async (fn, label) => {
    for (let i = 0; i < 200; i++) { const value = await fn(); if (value) return value; await delay(50); }
    throw Error(`Timed out: ${label}`);
  };
  const assert = (ok, label) => { if (!ok) throw Error(label); checks.push(label); };
  const ipc = (cmd, args = {}) => window.__TAURI_INTERNALS__.invoke(cmd, args);
  const notes = await ipc('initialize_notes_workspace');
  if (!notes.root.includes('/com.lukehightower.buster.parity-smoke')) throw Error('Requires isolated test storage');
  const reportPath = `${notes.root}/native-macos-spread-smoke-result.json`;
  const editor = () => document.querySelector('.tab-content.is-active .block-prose');
  const footer = text => [...document.querySelectorAll('.footer-nav button')].find(button => button.textContent === text).click();
  const key = (target, name, code, modifiers = {}) => {
    for (const type of ['keydown', 'keyup']) target.dispatchEvent(new KeyboardEvent(type, { key: name, code, ...modifiers, bubbles: true, cancelable: true }));
  };
  const layer = () => document.querySelector('.text-motion-layer');
  const opening = () => document.querySelector('.text-motion-opening');
  const words = paragraph => {
    const found = [], range = document.createRange();
    const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      for (const match of node.data.matchAll(/\S+/g)) {
        range.setStart(node, match.index); range.setEnd(node, match.index + match[0].length);
        const rect = [...range.getClientRects()].find(r => r.width > 0);
        if (rect) found.push({ text: match[0], left: rect.left, top: rect.top, width: rect.width, height: rect.height });
      }
    }
    return found;
  };
  const lines = list => {
    const tops = [];
    for (const word of list) if (!tops.some(top => Math.abs(top - word.top) < 4)) tops.push(word.top);
    return tops.sort((a, b) => a - b);
  };
  const rightClick = (x, y) => {
    const target = document.elementFromPoint(x, y);
    const event = new MouseEvent('contextmenu', { clientX: x, clientY: y, button: 2, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event;
  };
  const openOn = async word => {
    window.__textMotion = undefined;
    const event = rightClick(word.left + word.width / 2, word.top + 4);
    assert(event.defaultPrevented, `Right-clicking “${word.text}” replaces the native menu`);
    await wait(() => opening()?.classList.contains('is-visible') && window.__textMotion, 'spread settled');
  };
  const closed = () => wait(() => !layer() && !document.querySelector('.text-motion-ghost') && !document.querySelector('.text-motion-spacer'), 'spread closed');

  const prose = 'The harbor lantern swung over the quiet water while the night crew counted crates and argued softly about the tide tables, ' +
    'and somewhere past the breakwater a bell kept time with the waves as the fog rolled in from the open sea, ' +
    'carrying the smell of salt and diesel and old rope across the wet planks of the pier where the gulls slept in rows. ' +
    'Nobody noticed the small boat drifting without lights until it bumped the pilings below the customs shed.';
  try {
    await wait(() => document.querySelector('.footer-nav'), 'workspace initialization');
    assert(navigator.platform.startsWith('Mac'), 'Running in native macOS WebKit');
    footer('New Note');
    const note = await wait(editor, 'new note');
    note.focus();
    document.execCommand('insertText', false, prose);
    key(note, 'Enter', 'Enter');
    document.execCommand('insertText', false, 'A second paragraph that should slide down.');
    key(note, 'Enter', 'Enter');
    document.execCommand('insertText', false, 'A third paragraph, also below the opening.');
    await delay(300);
    const [first, second, third] = note.querySelectorAll('p');
    assert(first && second && third, 'Three paragraphs written');
    const before = words(first);
    const tops = lines(before);
    assert(tops.length >= 4, `First paragraph wraps to ${tops.length} lines`);
    const secondTop = second.getBoundingClientRect().top;
    const target = before.filter(word => Math.abs(word.top - tops[1]) < 4 && /^[a-z]{4,}$/i.test(word.text))[2];
    assert(!!target, `Target word on line 2: “${target?.text}”`);

    // ── First frame matches the page exactly ──────────────────────────
    window.__textMotion = undefined;
    const event = rightClick(target.left + target.width / 2, target.top + 4);
    assert(event.defaultPrevented, 'Right-clicking a word replaces the native menu');
    const spans = [...document.querySelectorAll('.text-motion-word')];
    assert(spans.length === before.length, `Motion layer holds every word (${spans.length})`);
    // WebKit reports the page's text rects snapped outward to whole pixels.
    // Snap each overlay glyph box the same way; every edge must agree.
    const errors = { left: 0, top: 0, right: 0, bottom: 0 };
    const glyphs = document.createRange();
    spans.forEach((span, index) => {
      glyphs.selectNodeContents(span);
      const rect = glyphs.getBoundingClientRect(), origin = before[index];
      const edges = { left: Math.abs(Math.floor(rect.left) - origin.left), top: Math.abs(Math.floor(rect.top) - origin.top),
        right: Math.abs(Math.ceil(rect.right) - (origin.left + origin.width)), bottom: Math.abs(Math.ceil(rect.bottom) - (origin.top + origin.height)) };
      for (const edge of Object.keys(edges)) {
        if (edges[edge] > errors[edge]) metrics[`worst_${edge}`] = { word: origin.text, index, page: origin, layer: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } };
        errors[edge] = Math.max(errors[edge], edges[edge]);
      }
    });
    metrics.firstFrameEdgeErrorPx = errors;
    const worst = Math.max(...Object.values(errors));
    assert(worst <= 1, `First frame matches the page's snapped glyph boxes (worst edge ${worst}px)`);
    assert(getSelection().toString() === target.text, 'The word under the pointer is selected');

    // ── Parted around the opening ─────────────────────────────────────
    await wait(() => opening()?.classList.contains('is-visible') && window.__textMotion, 'spread settled');
    metrics.open = { ...window.__textMotion };
    assert(window.__textMotion.reflowed, 'The paragraph reflowed with Pretext');
    const hole = opening().getBoundingClientRect();
    const overlaps = [...document.querySelectorAll('.text-motion-word')].filter(span => {
      const r = span.getBoundingClientRect();
      return r.right > hole.left + 1 && r.left < hole.right - 1 && r.bottom > hole.top + 1 && r.top < hole.bottom - 1;
    }).map(span => span.textContent);
    assert(!overlaps.length, `No word overlaps the opening (${overlaps.join(', ')})`);
    const targetSpan = document.querySelector('.text-motion-word.is-target');
    assert(targetSpan?.textContent === target.text && !targetSpan.style.transform, 'The target word stays where it was');
    const aboveMoved = [...document.querySelectorAll('.text-motion-word')]
      .filter((span, index) => before[index].top < tops[1] - 2 && span.style.transform);
    assert(!aboveMoved.length, 'Lines above the word do not move');
    const pushed = second.getBoundingClientRect().top - secondTop;
    metrics.secondParagraphShiftPx = pushed;
    assert(pushed > hole.height * 0.5, `Later paragraphs slide down (${pushed.toFixed(1)}px)`);
    assert(third.getBoundingClientRect().top > second.getBoundingClientRect().top, 'Block order is preserved');
    const buttons = [...opening().querySelectorAll('button')];
    assert(buttons.map(b => b.textContent).join(',') === 'Copy,Paste,Define,Bold,Italic,Spelling', 'The opening offers Copy, Paste, Define, Bold, Italic, Spelling');
    assert(!buttons[2].disabled && !buttons[4].disabled && buttons[5].disabled, 'Define and Italic are ready; Spelling is marked as coming next');
    const boxes = buttons.map(b => b.getBoundingClientRect());
    const sameRow = (a, b) => Math.abs(a.top - b.top) < 1;
    assert(sameRow(boxes[0], boxes[1]) && sameRow(boxes[1], boxes[2]) && sameRow(boxes[3], boxes[4]) && sameRow(boxes[4], boxes[5]) && boxes[3].top > boxes[0].bottom,
      'Actions sit in two rows of three');
    const columnDrift = Math.max(...[0, 1, 2].map(i => Math.abs(boxes[i].left - boxes[i + 3].left)));
    assert(columnDrift < 1, `The rows line up in three columns (${columnDrift.toFixed(2)}px)`);
    assert(boxes.every(r => { const o = opening().getBoundingClientRect(); return r.top >= o.top && r.bottom <= o.bottom && r.left >= o.left && r.right <= o.right; }),
      'Both rows fit inside the opening');
    assert(buttons.every(b => b.scrollWidth <= b.clientWidth), 'Every action label fits its button');

    // ── Escape returns every word exactly ─────────────────────────────
    key(window, 'Escape', 'Escape');
    await closed();
    await frame();
    const after = words(first);
    let drift = 0;
    after.forEach((word, index) => { drift = Math.max(drift, Math.abs(word.left - before[index].left), Math.abs(word.top - before[index].top)); });
    metrics.returnDriftPx = drift;
    assert(after.length === before.length && drift < 0.01, `Escape returns the text exactly (drift ${drift}px)`);
    assert(Math.abs(second.getBoundingClientRect().top - secondTop) < 0.01, 'Later paragraphs return exactly');
    assert(first.textContent === prose, 'The note text is unchanged');

    // ── Copy through the catalog, then the same exact return ──────────
    await openOn(words(first)[5]);
    opening().querySelector('button').click();
    await closed();
    assert(first.textContent === prose, 'Copy leaves the note unchanged');

    // ── Define: the opening grows and the word's letters spell the headword ──
    const defineWord = words(first).find(word => word.text === 'lantern');
    await openOn(defineWord);
    const menuHole = opening().getBoundingClientRect();
    window.__textMotion = undefined;
    [...opening().querySelectorAll('button')].find(b => b.textContent === 'Define').click();
    await wait(() => document.querySelector('.text-motion-definition') && window.__textMotion, 'definition settled');
    await delay(1600); // let the definition finish streaming in
    metrics.define = { ...window.__textMotion };
    const panel = document.querySelector('.text-motion-definition');
    if (panel.querySelector('.empty')) {
      assert(/No definition/.test(panel.textContent), 'Define reports a missing dictionary entry in place');
    } else {
      const grown = opening().getBoundingClientRect();
      metrics.defineOpening = { before: { width: menuHole.width, height: menuHole.height }, after: { width: grown.width, height: grown.height } };
      assert(grown.height > menuHole.height, `Define grows the opening (${menuHole.height} → ${grown.height}px)`);
      const letters = [...document.querySelectorAll('.text-motion-letter')];
      const headword = panel.querySelector('.headword').textContent;
      metrics.headword = headword;
      assert(letters.filter(l => !l.classList.contains('is-arriving')).length === 'lantern'.length, 'Every letter of the word takes flight');
      const shown = letters.filter(l => !l.classList.contains('is-fading'));
      const outside = shown.filter(l => {
        const r = l.getBoundingClientRect();
        return r.left < grown.left - 2 || r.right > grown.right + 2 || r.top < grown.top - 2 || r.bottom > grown.bottom + 2;
      }).map(l => l.textContent);
      assert(!outside.length, `Letters land inside the opening (${outside.join('')})`);
      const spelled = shown.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left).map(l => l.textContent).join('');
      assert(spelled.toLowerCase() === headword.toLowerCase(), `Letters spell the headword “${spelled}”`);
      assert(headword === 'lantern' && !letters.some(l => l.classList.contains('is-arriving')), 'The word itself becomes the headword, with nothing added');
      const crowding = [...document.querySelectorAll('.text-motion-word')].filter(span => {
        if (span.style.visibility === 'hidden' || span.querySelector('span')) return false;
        const r = span.getBoundingClientRect();
        return r.right > grown.left + 1 && r.left < grown.right - 1 && r.bottom > grown.top + 1 && r.top < grown.bottom - 1;
      }).map(span => span.textContent);
      assert(!crowding.length, `No word overlaps the grown opening (${crowding.join(', ')})`);
      assert(panel.querySelectorAll('.sense').length > 0 && panel.textContent.length > 20, 'The definition streams into the opening');
    }
    key(window, 'Escape', 'Escape');
    await closed();
    await frame();
    const afterDefine = words(first);
    let defineDrift = 0;
    afterDefine.forEach((word, index) => { defineDrift = Math.max(defineDrift, Math.abs(word.left - before[index].left), Math.abs(word.top - before[index].top)); });
    metrics.defineReturnDriftPx = defineDrift;
    assert(defineDrift < 0.01 && first.textContent === prose, `Escape after Define returns the text exactly (drift ${defineDrift}px)`);

    // ── Bold through the catalog changes the note ─────────────────────
    const boldWord = words(first).find(word => word.text === 'lantern');
    await openOn(boldWord);
    [...opening().querySelectorAll('button')].find(b => b.textContent === 'Bold').click();
    await closed();
    await wait(() => first.querySelector('strong')?.textContent === 'lantern', 'bold applied');
    assert(true, 'Bold wraps the word in the note');
    key(note, 'z', 'KeyZ', { metaKey: true });
    await wait(() => !first.querySelector('strong'), 'undo bold');
    assert(true, 'Undo removes the bold in one step');

    // ── Italic through the catalog changes the note ───────────────────
    await openOn(words(first).find(word => word.text === 'lantern'));
    [...opening().querySelectorAll('button')].find(b => b.textContent === 'Italic').click();
    await closed();
    await wait(() => first.querySelector('em')?.textContent === 'lantern', 'italic applied');
    assert(true, 'Italic wraps the word in the note');
    key(note, 'z', 'KeyZ', { metaKey: true });
    await wait(() => !first.querySelector('em'), 'undo italic');
    assert(true, 'Undo removes the italic in one step');

    // ── A phrase across a line break: its own actions and panels ─────
    const selectWords = async (paragraph, from, to) => {
      // Map the nth \S+ run of the paragraph's text to DOM text-node offsets.
      const nodes = [], walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node);
      const runs = [];
      for (const node of nodes) for (const match of node.data.matchAll(/\S+/g)) runs.push({ node, start: match.index, end: match.index + match[0].length });
      getSelection().setBaseAndExtent(runs[from].node, runs[from].start, runs[to].node, runs[to].end);
      document.dispatchEvent(new Event('selectionchange'));
      await delay(120);
    };
    const phraseWords = words(first);
    const phraseTops = lines(phraseWords);
    const lineOne = phraseWords.map((w, i) => i).filter(i => Math.abs(phraseWords[i].top - phraseTops[0]) < 4);
    const phraseFrom = lineOne[lineOne.length - 2], phraseTo = lineOne[lineOne.length - 1] + 2;
    const phraseText = phraseWords.slice(phraseFrom, phraseTo + 1).map(w => w.text).join(' ');
    const openPhrase = async () => {
      await selectWords(first, phraseFrom, phraseTo);
      assert(getSelection().toString().replace(/\s+/g, ' ') === phraseText, `Selected the phrase “${phraseText}” across a line break`);
      window.__textMotion = undefined;
      const inside = phraseWords[phraseTo];
      const event = rightClick(inside.left + inside.width / 2, inside.top + 4);
      assert(event.defaultPrevented, 'Right-clicking the selected phrase replaces the native menu');
      await wait(() => opening()?.classList.contains('is-visible') && window.__textMotion, 'phrase spread settled');
    };
    await openPhrase();
    const phraseButtons = [...opening().querySelectorAll('button')].map(b => b.textContent).join(',');
    assert(phraseButtons === 'Copy,Bold,Italic,Search,Count,Rephrase', `A phrase offers Copy, Bold, Italic, Search, Count, Rephrase (${phraseButtons})`);
    const phraseSpans = [...document.querySelectorAll('.text-motion-word.is-target')];
    assert(phraseSpans.map(span => span.textContent).join(' ') === phraseText, 'Every word of the phrase is the target');
    assert(phraseSpans.every(span => !span.style.transform), 'The phrase stays where it was');
    const phraseHole = opening().getBoundingClientRect();
    assert(phraseHole.top >= phraseWords[phraseTo].top + phraseWords[phraseTo].height - 1, 'The opening sits below the phrase’s last line');
    const phraseOverlap = [...document.querySelectorAll('.text-motion-word')].filter(span => {
      const r = span.getBoundingClientRect();
      return r.right > phraseHole.left + 1 && r.left < phraseHole.right - 1 && r.bottom > phraseHole.top + 1 && r.top < phraseHole.bottom - 1;
    }).map(span => span.textContent);
    assert(!phraseOverlap.length, `No word overlaps the phrase’s opening (${phraseOverlap.join(', ')})`);

    // Count grows the opening and reports the phrase.
    window.__textMotion = undefined;
    [...opening().querySelectorAll('button')].find(b => b.textContent === 'Count').click();
    await wait(() => document.querySelector('.text-motion-count') && window.__textMotion, 'count settled');
    const counted = document.querySelector('.text-motion-count .count-words strong').textContent;
    assert(counted === String(phraseText.split(' ').length), `Count reports ${counted} words`);
    assert(opening().getBoundingClientRect().height > phraseHole.height, 'Count grows the opening');
    const useRows = [...document.querySelectorAll('.text-motion-count .count-uses tbody tr')]
      .map(row => [...row.children].map(cell => cell.textContent));
    metrics.wordUses = useRows;
    const theRow = useRows.find(row => row[0] === 'the');
    assert(useRows.length === new Set(phraseText.toLowerCase().match(/[a-z]+/g)).size, `Count lists each word once (${useRows.map(r => r[0]).join(', ')})`);
    assert(theRow && theRow[1] === '1' && Number(theRow[2]) === ([...note.querySelectorAll('p')].map(p => p.textContent).join(' ').match(/\bthe\b/gi) ?? []).length, `Count shows how often “the” is used in the note (${theRow?.[2]})`);
    key(window, 'Escape', 'Escape');
    await closed();

    // Search finds the phrase in this note.
    await openPhrase();
    [...opening().querySelectorAll('button')].find(b => b.textContent === 'Search').click();
    await wait(() => document.querySelector('.text-motion-search .search-note, .text-motion-search .empty'), 'search results');
    const thisNote = [...document.querySelectorAll('.text-motion-search .search-note-name')].some(name => /this note/.test(name.textContent));
    assert(thisNote, 'Search lists this note');
    assert(document.querySelector('.text-motion-search mark')?.textContent.toLowerCase() === phraseText.toLowerCase(), 'Search marks the phrase in the match');
    key(window, 'Escape', 'Escape');
    await closed();

    // Rephrase: the one-time notice names Claude, then Haiku answers through the subscription.
    await openPhrase();
    [...opening().querySelectorAll('button')].find(b => b.textContent === 'Rephrase').click();
    await wait(() => document.querySelector('.text-motion-rephrase .source'), 'rephrase panel');
    const rephrasePanel = () => document.querySelector('.text-motion-rephrase');
    assert(/Claude/.test(rephrasePanel().textContent) && /subscription/.test(rephrasePanel().querySelector('.source').textContent),
      'Rephrase says the passage goes to Claude through the subscription');
    const send = [...rephrasePanel().querySelectorAll('button')].find(b => b.textContent === 'Send');
    assert(!!send, 'Rephrase asks before the first passage leaves the Mac');
    send.click();
    for (let i = 0; i < 1200 && !rephrasePanel()?.querySelector('.rephrase-option, [role="alert"]'); i++) await delay(100);
    const failure = rephrasePanel()?.querySelector('[role="alert"]')?.textContent;
    metrics.rephraseSource = rephrasePanel()?.querySelector('.source')?.textContent;
    if (failure) {
      metrics.rephraseSkipped = failure;
      key(window, 'Escape', 'Escape');
      await closed();
    } else {
      const choices = [...rephrasePanel().querySelectorAll('.rephrase-option')].map(b => b.textContent);
      metrics.rephrasings = choices;
      assert(choices.length >= 1 && choices.length <= 3 && choices.every(c => c && c.toLowerCase() !== phraseText.toLowerCase()),
        `Claude returns rephrasings (${choices.join(' | ')})`);
      assert(/Haiku 5\.5/.test(metrics.rephraseSource), `Haiku 5.5 answers first (${metrics.rephraseSource})`);
      assert([...rephrasePanel().querySelectorAll('button')].some(b => b.textContent === 'Try Sonnet 5.5'), 'Rephrase offers Sonnet 5.5 next');
      const chosen = choices[0];
      rephrasePanel().querySelector('.rephrase-option').click();
      await closed();
      await wait(() => first.textContent.includes(chosen), 'rephrasing applied');
      assert(!first.textContent.includes(phraseText) || chosen.includes(phraseText), 'Choosing a rephrasing replaces the selection');
      key(note, 'z', 'KeyZ', { metaKey: true });
      await wait(() => first.textContent === prose, 'undo rephrase');
      assert(true, 'Undo restores the original phrase in one step');
    }
    await frame();
    let phraseDrift = 0;
    words(first).forEach((word, index) => { phraseDrift = Math.max(phraseDrift, Math.abs(word.left - before[index].left), Math.abs(word.top - before[index].top)); });
    assert(phraseDrift < 0.01 && first.textContent === prose, `Escape after the phrase panels returns the text exactly (drift ${phraseDrift}px)`);

    // ── Off a word the native menu is untouched ───────────────────────
    const rect = third.getBoundingClientRect();
    const blank = rightClick(rect.right - 2, rect.top + 4);
    assert(!blank.defaultPrevented && !layer(), 'Right-clicking blank space keeps the native menu');

    const result = { ok: true, phase: 1, checks, metrics };
    try { await ipc('create_file', { path: reportPath }); } catch { /* Existing report. */ }
    await ipc('write_file', { path: reportPath, content: JSON.stringify(result, null, 2) });
    key(window, 'q', 'KeyQ', { metaKey: true });
  } catch (error) {
    const result = { ok: false, checks, metrics, error: String(error), stack: error.stack,
      motion: window.__textMotion, layer: layer()?.outerHTML?.slice(0, 4000), activeElement: document.activeElement?.outerHTML?.slice(0, 500) };
    try { await ipc('create_file', { path: reportPath }); } catch { /* Existing report. */ }
    await ipc('write_file', { path: reportPath, content: JSON.stringify(result, null, 2) });
  }
})();
