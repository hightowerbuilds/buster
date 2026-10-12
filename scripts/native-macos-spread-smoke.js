// Inject only into a disposable build whose identifier contains ".parity-smoke".
// The full run takes about two minutes and needs the window in front (clipboard
// writes and animation frames stop when it loses focus); `--only courier` runs
// just the Courier section in about twenty seconds.
// Exercises the Spread menu (growth/phases/text-motion.md) in the real WKWebView:
// pixel-exact first frame, parting around the opening, exact return, catalog actions.
void (async () => {
  const checks = [];
  const metrics = {};
  /** A single section to run, set by prepare-native-macos-smoke.py --only (null runs everything). */
  const only = window.__SMOKE_ONLY__ ?? null;
  if (only) metrics.only = only;
  // Anything the page reports goes into a failure report.
  const pageErrors = [];
  addEventListener('error', e => pageErrors.push(`${e.message} @ ${e.filename}:${e.lineno}:${e.colno}\n${e.error?.stack ?? ''}`.slice(0, 1500)));
  addEventListener('unhandledrejection', e => pageErrors.push(`rejection: ${e.reason?.stack ?? e.reason}`.slice(0, 800)));
  const originalError = console.error.bind(console);
  console.error = (...args) => { pageErrors.push('console.error: ' + args.map(a => a?.stack ?? String(a)).join(' ').slice(0, 800)); originalError(...args); };
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
  // Words that Pretext may break inside: hyphens, dashes, brackets, slashes, and long words.
  const dashed = 'In 1841 the Saxe-Altenburg princesses—Theresa, Elizabeth, and Alexandra—met our great-grandfather, ' +
    'a well-known, long-lived, self-controlled man [see p. 12]; his daughter-in-law\'s convent-school and/or the ' +
    'thirty-one paving-stones of the vicarage were, in a word, incomprehensibilities to the grandparents—misunderstandings, ' +
    'sentimentality, and a lifetime of half-remembered Grand-mamma stories (1890–1900) followed them everywhere.';
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
    key(note, 'Enter', 'Enter');
    document.execCommand('insertText', false, dashed);
    await delay(300);
    const [first, second, third] = note.querySelectorAll('p');
    assert(first && second && third, 'Three paragraphs written');
    const before = words(first);
    const tops = lines(before);
    assert(tops.length >= 4, `First paragraph wraps to ${tops.length} lines`);
    const secondTop = second.getBoundingClientRect().top;
    const target = before.filter(word => Math.abs(word.top - tops[1]) < 4 && /^[a-z]{4,}$/i.test(word.text))[2];
    assert(!!target, `Target word on line 2: “${target?.text}”`);

    const activeTab = () => [...document.querySelectorAll('.tab-bar [role="tab"]')].find(tab => tab.getAttribute('aria-selected') === 'true').id;
    const driftBetween = (a, b) => a.length !== b.length ? Infinity : a.reduce((max, w, i) => Math.max(max, Math.abs(w.left - b[i].left), Math.abs(w.top - b[i].top)), 0);
    const overlapping = hole => [...document.querySelectorAll('.text-motion-word')].filter(span => {
      if (span.querySelector('span') || span.classList.contains('is-leaving')) return false;
      const r = span.getBoundingClientRect();
      return r.right > hole.left + 1 && r.left < hole.right - 1 && r.bottom > hole.top + 1 && r.top < hole.bottom - 1;
    }).map(span => span.textContent);
    const action = label => [...opening().querySelectorAll('button')].find(b => b.textContent === label);

    // Keyboard entry, neighbouring paragraphs, Keep as note, landing after an
    // edit, resizing, Spelling, the motion setting, and printing.
    const polish = async () => {
      const homeTab = activeTab();
      const toHome = async () => { document.getElementById(homeTab).click(); await wait(() => editor() === note, 'back to the first note'); };
      const base1 = words(first), base2 = words(second);

      // ── Keyboard: Shift+F10 opens a labelled menu with focus on the first action ──
      note.focus();
      const walker = document.createTreeWalker(first, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const at = node.data.indexOf('lantern');
        if (at >= 0) { getSelection().collapse(node, at + 3); break; }
      }
      await delay(150);
      window.__textMotion = undefined;
      key(note, 'F10', 'F10', { shiftKey: true });
      await wait(() => opening()?.classList.contains('is-visible') && window.__textMotion, 'keyboard spread');
      const menu = opening().querySelector('[role="menu"]');
      assert(menu && /lantern/.test(menu.getAttribute('aria-label')), `Shift+F10 opens the spread as a labelled menu (${menu?.getAttribute('aria-label')})`);
      const items = [...menu.querySelectorAll('[role="menuitem"]')];
      await wait(() => document.activeElement === items[0], 'focus on the first action');
      assert(true, 'Keyboard entry focuses the first action');
      assert(layer().getAttribute('aria-hidden') === 'true', 'The moving words are hidden from assistive technology');
      key(document.activeElement, 'ArrowRight', 'ArrowRight');
      assert(document.activeElement === items[1], 'ArrowRight moves to the next action');
      key(document.activeElement, 'ArrowDown', 'ArrowDown');
      assert(document.activeElement === items[4], 'ArrowDown moves to the action below');
      key(document.activeElement, 'Escape', 'Escape');
      await closed();
      assert(document.activeElement === note, 'Escape returns focus to the note');

      // ── Neighbours: Define near a paragraph's end parts the next paragraph too ──
      const lastTop = lines(base1).at(-1);
      const lastWords = base1.filter(w => Math.abs(w.top - lastTop) < 4 && /^[a-z]{5,}$/i.test(w.text));
      const defineOn = lastWords[Math.floor(lastWords.length / 2)];
      await openOn(defineOn);
      metrics.neighbourParagraphs = window.__textMotion.paragraphs;
      assert(window.__textMotion.paragraphs >= 2, `The paragraphs below join the spread (${window.__textMotion.paragraphs})`);
      window.__textMotion = undefined;
      action('Define').click();
      await wait(() => document.querySelector('.text-motion-definition') && window.__textMotion, 'definition settled');
      await delay(1200);
      const definition = document.querySelector('.text-motion-definition');
      if (definition.querySelector('.empty')) metrics.neighbourSkipped = `no definition for ${defineOn.text}`;
      else {
        const grown = opening().getBoundingClientRect();
        const crowd = overlapping(grown);
        assert(!crowd.length, `No word of any paragraph overlaps the grown opening (${crowd.join(', ')})`);
        const firstEnd = Math.max(...[...document.querySelectorAll('.text-motion-word')].slice(0, base1.length).map(span => span.getBoundingClientRect().bottom));
        const secondSpans = [...document.querySelectorAll('.text-motion-word')].slice(base1.length, base1.length + base2.length);
        const beside = secondSpans.filter(span => { const r = span.getBoundingClientRect(); return r.top < grown.bottom - 1 && r.bottom > grown.top + 1; });
        metrics.neighbour = { firstEnd, openingBottom: grown.bottom, beside: beside.map(span => span.textContent) };
        assert(firstEnd < grown.bottom && beside.length > 0, `The next paragraph flows beside the opening (${beside.map(span => span.textContent).join(' ')})`);
        // Keep as note: the definition becomes a note of its own.
        const keep = [...definition.querySelectorAll('button')].find(b => b.textContent === 'Keep as note');
        assert(!!keep, 'Define offers Keep as note');
        keep.click();
        await wait(() => keep.textContent === 'Kept', 'definition kept');
        const headword = definition.querySelector('.headword').textContent;
        const kept = await ipc('read_file', { path: `${notes.root}/${headword} (definition).md` }).catch(error => ({ error: String(error) }));
        metrics.keptNote = (kept.content ?? kept.error ?? '').slice(0, 200);
        assert(kept.content?.startsWith(`# ${headword}\n`) && /—/.test(kept.content), `Keep as note saves “${headword} (definition).md”`);
        assert(editor() === note && !!layer(), 'Keeping a definition leaves the spread and the note in front');
      }
      key(window, 'Escape', 'Escape');
      await closed();
      await frame();
      const neighbourDrift = Math.max(driftBetween(words(first), base1), driftBetween(words(second), base2));
      assert(neighbourDrift < 0.01, `Escape returns both paragraphs exactly (drift ${neighbourDrift}px)`);

      // ── A word in two pieces ("well-known") still flies letter by letter into the headword ──
      const dashedPara = note.querySelectorAll('p')[3];
      dashedPara.scrollIntoView({ block: 'center' }); await delay(150);
      const hyphenWalker = document.createTreeWalker(dashedPara, NodeFilter.SHOW_TEXT);
      let hyphenRect = null;
      for (let node = hyphenWalker.nextNode(); node; node = hyphenWalker.nextNode()) {
        const at = node.data.indexOf('well-known');
        if (at < 0) continue;
        const range = document.createRange();
        range.setStart(node, at); range.setEnd(node, at + 'well-known'.length);
        note.focus();
        getSelection().removeAllRanges(); getSelection().addRange(range);
        hyphenRect = [...range.getClientRects()].find(r => r.width > 0);
        break;
      }
      await delay(200);
      window.__textMotion = undefined;
      assert(rightClick(hyphenRect.left + hyphenRect.width / 2, hyphenRect.top + 4).defaultPrevented, 'Right-clicking the selected “well-known” opens the spread');
      await wait(() => opening()?.classList.contains('is-visible') && window.__textMotion, 'hyphen spread');
      window.__textMotion = undefined;
      action('Define').click();
      await wait(() => document.querySelector('.text-motion-definition') && window.__textMotion, 'hyphen definition');
      await delay(800);
      if (document.querySelector('.text-motion-definition .empty')) metrics.hyphenSkipped = 'no definition for well-known';
      else {
        const flying = [...document.querySelectorAll('.text-motion-letter')].filter(l => !l.classList.contains('is-arriving'));
        metrics.hyphenLetters = flying.map(l => l.textContent).join('');
        assert(flying.length === 'well-known'.length, `Both pieces of “well-known” take flight (${flying.length} letters)`);
        const shown = flying.filter(l => !l.classList.contains('is-fading')).sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
        const headword = document.querySelector('.text-motion-definition .headword').textContent;
        const letters = text => text.toLowerCase().replace(/[^\p{L}]/gu, '');
        assert(letters(shown.map(l => l.textContent).join('')) === letters(headword), `The pieces spell the headword “${headword}”`);
      }
      key(window, 'Escape', 'Escape');
      await closed();
      first.scrollIntoView({ block: 'center' }); await delay(150);

      // ── Bold lands every word on the edited text instead of fading ──
      await openOn(words(first).find(w => w.text === 'lantern'));
      window.__textMotionClose = undefined;
      action('Bold').click();
      await closed();
      const landing = window.__textMotionClose;
      metrics.boldLanding = landing;
      assert(landing?.mode === 'settle', `Bold closes by landing the words on the edited text (${landing?.mode})`);
      assert(landing.entering >= 1 && landing.leaving >= 1 && landing.matched >= base1.length + base2.length - 2,
        `Only the bolded word changes; the rest land in place (${landing.matched} kept, ${landing.entering} new, ${landing.leaving} gone)`);
      await wait(() => first.querySelector('strong')?.textContent === 'lantern', 'bold applied');
      key(note, 'z', 'KeyZ', { metaKey: true });
      await wait(() => !first.querySelector('strong'), 'undo bold');
      await frame();
      assert(driftBetween(words(first), base1) < 0.01, 'Undo restores the paragraph exactly');

      // ── Resizing the column re-measures and retargets mid-spread ──
      const scroller = note.closest('.block-editor');
      const resizeOn = base1.filter(w => Math.abs(w.top - lines(base1)[1]) < 4 && /^[a-z]{4,}$/i.test(w.text))[1];
      await openOn(resizeOn);
      window.__textMotion = undefined;
      scroller.style.width = '72%';
      await wait(() => window.__textMotion, 'relayout settled');
      assert(!!layer() && opening().classList.contains('is-visible'), 'Resizing the column keeps the spread open');
      const narrow = opening().getBoundingClientRect();
      const narrowCrowd = overlapping(narrow);
      assert(!narrowCrowd.length, `No word overlaps the opening after the resize (${narrowCrowd.join(', ')})`);
      const column = first.getBoundingClientRect();
      const outside = [...document.querySelectorAll('.text-motion-word')].filter(span => {
        const r = span.getBoundingClientRect();
        return r.right > column.right + 2 || r.left < column.left - 2;
      }).map(span => span.textContent);
      metrics.resize = { columnWidth: column.width, outside };
      assert(!outside.length, `Every word reflows into the narrower column (${outside.join(', ')})`);
      window.__textMotion = undefined;
      scroller.style.width = '';
      await wait(() => window.__textMotion, 'relayout back');
      key(window, 'Escape', 'Escape');
      await closed();
      await frame();
      const resizeDrift = driftBetween(words(first), base1);
      assert(resizeDrift < 0.01, `After resizing back, Escape returns the text exactly (drift ${resizeDrift}px)`);

      // ── Printing closes the spread first ──
      await openOn(words(first)[5]);
      window.dispatchEvent(new Event('beforeprint'));
      await closed();
      assert(true, 'Printing closes the spread, so the note prints as written');

      // ── Spread Motion: Off, Calm, Wild ──
      const motionButtons = async () => {
        footer('Settings');
        return wait(() => { const found = [...document.querySelectorAll('.tab-content.is-active .settings-motion-btns button')]; return found.length ? found : null; }, 'Spread Motion setting');
      };
      let buttons = await motionButtons();
      assert(buttons.map(b => b.textContent).join(',') === 'Off,Calm,Wild', 'Spread Motion offers Off, Calm, Wild');
      buttons[2].click();
      await toHome();
      await openOn(words(first)[5]);
      assert(window.__textMotion.motion === 'wild', 'Wild applies to the next spread');
      key(window, 'Escape', 'Escape');
      await closed();
      buttons = await motionButtons();
      buttons[0].click();
      await toHome();
      await openOn(words(first)[5]);
      assert(window.__textMotion.motion === 'off' && window.__textMotion.frames === 0, 'Off places everything at once, with no frames of motion');
      key(window, 'Escape', 'Escape');
      await closed();
      await frame();
      assert(driftBetween(words(first), base1) < 0.01, 'Off returns the text exactly too');
      buttons = await motionButtons();
      buttons[1].click();
      await toHome();

      // ── Spelling & Grammar on the writer's subscription ──
      footer('New Note');
      const spellNote = await wait(() => editor() !== note && editor(), 'spelling note');
      spellNote.focus();
      document.execCommand('insertText', false, 'Their going to the stor tomorrow to buy bread.');
      await delay(300);
      const line = () => spellNote.querySelector('p');
      const spellPanel = () => document.querySelector('.text-motion-spelling');
      const check = async word => {
        await openOn(words(line()).find(w => w.text === word));
        action('Spelling').click();
        await wait(spellPanel, 'spelling panel');
        const send = [...spellPanel().querySelectorAll('button')].find(b => b.textContent === 'Send');
        if (send) {
          assert(new RegExp(`sentence around “${word}”`).test(spellPanel().textContent), 'Spelling says what it sends before the first request');
          send.click();
        }
        for (let i = 0; i < 1200 && !spellPanel()?.querySelector('.flagged, [role="alert"]'); i++) await delay(100);
        return spellPanel()?.querySelector('[role="alert"]')?.textContent ?? null;
      };
      const failure = await check('stor');
      if (failure) metrics.spellingSkipped = failure;
      else {
        metrics.spellingSource = spellPanel().querySelector('.source').textContent;
        const suggestions = [...spellPanel().querySelectorAll('.spelling-suggestions button')].map(b => b.textContent);
        metrics.spelling = { suggestions, grammar: [...spellPanel().querySelectorAll('.grammar')].map(g => g.textContent) };
        assert(/Haiku 5\.5/.test(metrics.spellingSource), `Haiku 5.5 checks spelling first (${metrics.spellingSource})`);
        assert(spellPanel().querySelector('.flagged').textContent === 'stor' && suggestions.includes('store'), `Spelling flags “stor” and suggests “store” (${suggestions.join(', ')})`);
        assert([...spellPanel().querySelectorAll('button')].some(b => b.textContent === 'Try Sonnet 5.5'), 'Spelling offers Sonnet 5.5 next');
        window.__textMotionClose = undefined;
        [...spellPanel().querySelectorAll('.spelling-suggestions button')].find(b => b.textContent === 'store').click();
        await closed();
        assert(line().textContent === 'Their going to the store tomorrow to buy bread.', 'Choosing a suggestion corrects the word');
        assert(window.__textMotionClose?.mode === 'settle', 'The corrected word settles into the line');
        const grammarFailure = await check('Their');
        const fix = spellPanel()?.querySelector('.grammar button');
        if (grammarFailure || !fix) metrics.grammarSkipped = grammarFailure ?? 'no grammar issue returned';
        else {
          const replacement = spellPanel().querySelector('.grammar ins').textContent;
          metrics.grammarFix = spellPanel().querySelector('.grammar').textContent;
          fix.click();
          await closed();
          assert(line().textContent.includes(replacement) && !line().textContent.startsWith('Their going'), `Fix applies the grammar correction (“${replacement}”)`);
          key(spellNote, 'z', 'KeyZ', { metaKey: true });
          await wait(() => line().textContent.startsWith('Their going'), 'undo grammar fix');
          assert(true, 'Undo removes the grammar fix in one step');
        }
      }
      await toHome();
    };

    // `--only courier` (prepare-native-macos-smoke.py) runs just the Courier section.
    if (!only) {
      // ── First frame matches the page exactly ──────────────────────────
      window.__textMotion = undefined;
      const event = rightClick(target.left + target.width / 2, target.top + 4);
      assert(event.defaultPrevented, 'Right-clicking a word replaces the native menu');
      // The target paragraph's words come first; the paragraphs below it follow.
      const spans = [...document.querySelectorAll('.text-motion-word')].slice(0, before.length);
      assert(spans.map(span => span.textContent).join(' ') === before.map(word => word.text).join(' '), `Motion layer holds every word (${spans.length})`);
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
      // The paragraphs below take part in the spread: the layer draws them where they move to.
      const drawn = [...document.querySelectorAll('.text-motion-word')];
      const secondDrawn = drawn[before.length]?.getBoundingClientRect();
      const pushed = secondDrawn ? secondDrawn.top - secondTop : second.getBoundingClientRect().top - secondTop;
      metrics.secondParagraphShiftPx = pushed;
      metrics.spreadParagraphs = window.__textMotion.paragraphs;
      assert(pushed > hole.height * 0.5, `Later paragraphs slide down (${pushed.toFixed(1)}px)`);
      assert(drawn[before.length]?.textContent === 'A' || second.getBoundingClientRect().top > secondTop, 'The next paragraph moves with the spread');
      assert(third.getBoundingClientRect().top > second.getBoundingClientRect().top, 'Block order is preserved');
      const buttons = [...opening().querySelectorAll('button')];
      assert(buttons.map(b => b.textContent).join(',') === 'Copy,Paste,Define,Bold,Italic,Spelling', 'The opening offers Copy, Paste, Define, Bold, Italic, Spelling');
      assert(buttons.every(b => !b.disabled), 'Every action is ready, Spelling included');
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
      if (first.textContent !== prose) metrics.copyMismatch = { now: first.textContent, html: first.outerHTML.slice(0, 600), paragraphs: [...note.querySelectorAll(':scope > *')].map(b => `${b.tagName}:${b.textContent.slice(0, 40)}`) };
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

      // ── Words that break inside: every line still parts ───────────────
      const fourth = note.querySelectorAll('p')[3];
      assert(fourth?.textContent === dashed, 'A paragraph of hyphenated and dashed words was written');
      fourth.scrollIntoView({ block: 'center' }); await delay(150);
      const dashedBefore = words(fourth);
      const dashedLines = lines(dashedBefore);
      assert(dashedLines.length >= 3, `The dashed paragraph wraps to ${dashedLines.length} lines`);
      const failures = [];
      for (const [lineIndex, top] of dashedLines.entries()) {
        const onLine = words(fourth).filter(word => Math.abs(word.top - top) < 4 && /[a-z]{3,}/i.test(word.text));
        const target = onLine[Math.floor(onLine.length / 2)];
        if (!target) continue;
        window.__textMotion = undefined;
        const hit = rightClick(target.left + Math.min(8, target.width / 2), target.top + 4);
        if (!hit.defaultPrevented) { failures.push(`line ${lineIndex}: did not open on “${target.text}”`); continue; }
        await wait(() => opening()?.classList.contains('is-visible') && window.__textMotion, 'dashed spread settled');
        if (!window.__textMotion.reflowed) failures.push(`line ${lineIndex}: ${window.__textMotion.fallback}`);
        const hole = opening().getBoundingClientRect();
        const crowded = [...document.querySelectorAll('.text-motion-word')].filter(span => {
          const r = span.getBoundingClientRect();
          return r.right > hole.left + 1 && r.left < hole.right - 1 && r.bottom > hole.top + 1 && r.top < hole.bottom - 1;
        }).map(span => span.textContent);
        if (crowded.length) failures.push(`line ${lineIndex}: overlaps ${crowded.join(' ')}`);
        key(window, 'Escape', 'Escape');
        await closed();
      }
      metrics.dashedLines = dashedLines.length;
      assert(!failures.length, `Every line of the dashed paragraph parts the text (${failures.join('; ')})`);
      await frame();
      let dashedDrift = 0;
      words(fourth).forEach((word, index) => { dashedDrift = Math.max(dashedDrift, Math.abs(word.left - dashedBefore[index].left), Math.abs(word.top - dashedBefore[index].top)); });
      assert(dashedDrift < 0.01 && fourth.textContent === dashed, `Escape returns the dashed paragraph exactly (drift ${dashedDrift}px)`);

      // First frame for pieces: open on the dashed paragraph and compare every glyph box to the page.
      const firstLine = words(fourth).filter(word => Math.abs(word.top - dashedLines[0]) < 4 && /[a-z]{3,}/i.test(word.text));
      window.__textMotion = undefined;
      rightClick(firstLine[1].left + 4, firstLine[1].top + 4);
      const pageGlyphs = [];
      const glyphWalker = document.createTreeWalker(fourth, NodeFilter.SHOW_TEXT);
      const pageRange = document.createRange();
      for (let node = glyphWalker.nextNode(); node; node = glyphWalker.nextNode()) {
        for (let i = 0; i < node.data.length; i++) {
          if (/\s/.test(node.data[i])) continue;
          pageRange.setStart(node, i); pageRange.setEnd(node, i + 1);
          const r = [...pageRange.getClientRects()].find(rect => rect.width > 0);
          if (r) pageGlyphs.push({ ch: node.data[i], left: r.left, top: r.top });
        }
      }
      const layerGlyphs = [];
      for (const span of document.querySelectorAll('.text-motion-word')) {
        const node = span.firstChild;
        if (!node || node.nodeType !== 3) continue;
        for (let i = 0; i < node.data.length; i++) {
          pageRange.setStart(node, i); pageRange.setEnd(node, i + 1);
          const r = [...pageRange.getClientRects()].find(rect => rect.width > 0);
          if (r) layerGlyphs.push({ ch: node.data[i], left: r.left, top: r.top });
        }
      }
      assert(layerGlyphs.map(g => g.ch).join('') === pageGlyphs.map(g => g.ch).join(''), 'The motion layer holds every character of the dashed paragraph, in order');
      const glyphErrors = layerGlyphs.map((g, i) => Math.max(Math.abs(g.left - pageGlyphs[i].left), Math.abs(g.top - pageGlyphs[i].top)));
      const glyphError = Math.max(...glyphErrors);
      const worstGlyph = glyphErrors.indexOf(glyphError);
      metrics.dashedFirstFrameGlyphErrorPx = glyphError;
      metrics.dashedWorstGlyph = { at: worstGlyph, context: pageGlyphs.slice(Math.max(0, worstGlyph - 6), worstGlyph + 4).map(g => g.ch).join(''),
        page: pageGlyphs[worstGlyph], layer: layerGlyphs[worstGlyph] };
      assert(glyphError <= 1.5, `The dashed paragraph's first frame matches the page glyph by glyph (worst ${glyphError.toFixed(2)}px)`);
      await wait(() => opening()?.classList.contains('is-visible') && window.__textMotion, 'dashed spread settled');
      key(window, 'Escape', 'Escape');
      await closed();
    }

    // ── Polish: keyboard entry, neighbours, landing after edits, resize, Spelling, motion ──
    if (!only || only === 'polish') await polish();

    // ── Courier: an ASCII drop cap on every paragraph ─────────────────
    if (!only || only === 'courier') {
    const artOf = (block, kind = '') => block?.querySelector(`:scope > .ascii-art${kind}`) ?? null;
    /** Type the way a person does: one key at a time. */
    const typeKeys = async text => { for (const ch of text) { document.execCommand('insertText', false, ch); await delay(25); } };
    const noteTabId = [...document.querySelectorAll('.tab-bar [role="tab"]')].find(tab => tab.getAttribute('aria-selected') === 'true').id;
    // The tab bar re-renders, so look the note's tab up each time.
    const noteTab = { click: () => document.getElementById(noteTabId).click() };
    footer('Settings');
    const courierButton = await wait(() => [...document.querySelectorAll('.tab-content.is-active button')].find(b => b.textContent === 'Courier'), 'Courier style button');
    assert([...courierButton.parentElement.querySelectorAll('button')].map(b => b.textContent).join(',') === 'None,Courier', 'Writing styles are None and Courier');
    courierButton.click();
    noteTab.click();
    await wait(() => editor() === note && document.querySelector('.block-editor[data-writing-style="courier"]'), 'Courier style applied');
    const paragraphs = [...note.querySelectorAll(':scope > p')].filter(p => /\S/.test(p.textContent));
    await wait(() => paragraphs.every(p => artOf(p)?.dataset.state === 'settled'), 'drop caps settled', 120);
    assert(paragraphs.length === 4, `Every paragraph has an ASCII drop cap (${paragraphs.length})`);
    // The cap floats at the paragraph's content corner, the text after the
    // (hidden) first letter starts at its right edge plus its margin, and it is
    // about three lines tall.
    const afterCap = p => {
      const node = p.querySelector('.drop-cap-letter').nextSibling;
      const r = document.createRange(); r.setStart(node, 0); r.setEnd(node, 1); return r.getBoundingClientRect();
    };
    const capOffsets = paragraphs.map(p => {
      const host = artOf(p).getBoundingClientRect(), outer = p.getBoundingClientRect();
      const cap = getComputedStyle(artOf(p)), block = getComputedStyle(p);
      return Math.max(
        Math.abs(host.right + parseFloat(cap.marginRight) - afterCap(p).left),
        Math.abs(host.left - (outer.left + parseFloat(block.paddingLeft))));
    });
    metrics.courierCapOffsetPx = Math.max(...capOffsets);
    assert(metrics.courierCapOffsetPx <= 1.5, `Each ASCII cap floats at its paragraph's start, with the text beside it (worst ${metrics.courierCapOffsetPx.toFixed(2)}px)`);
    const capLines = artOf(first).getBoundingClientRect().height / parseFloat(getComputedStyle(first).lineHeight);
    metrics.courierCapLines = capLines;
    assert(capLines >= 2.5, `The drop cap is about three lines tall (${capLines.toFixed(2)})`);
    const capBoxOf = p => artOf(p).getBoundingClientRect();
    const firstCap = artOf(first).querySelector('canvas');
    metrics.courierCapSize = [firstCap.width, firstCap.height];
    const inked = canvas => { const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 40) n++; return n; };
    assert(inked(firstCap) > 50, `The cap is drawn in ASCII (${inked(firstCap)} inked pixels)`);
    const realLetter = first.querySelector('.drop-cap-letter');
    assert(realLetter?.textContent === 'T' && getComputedStyle(realLetter).color === 'rgba(0, 0, 0, 0)' && realLetter.getBoundingClientRect().width < 1, 'The real first letter stays in the text, hidden behind the drawing');
    assert(first.textContent === prose, 'The drop cap adds nothing to the note text');
    try { await ipc('create_file', { path: `${notes.root}/courier-cap.txt` }); } catch { /* exists */ }
    await ipc('write_file', { path: `${notes.root}/courier-cap.txt`, content: firstCap.toDataURL('image/png') });

    // A new paragraph's cap assembles; the others keep theirs.
    const before4 = paragraphs.map(p => artOf(p));
    const fourthEnd = document.createRange(); fourthEnd.selectNodeContents(paragraphs[3]); fourthEnd.collapse(false);
    note.focus(); getSelection().removeAllRanges(); getSelection().addRange(fourthEnd);
    document.dispatchEvent(new Event('selectionchange')); await delay(80);
    key(note, 'Enter', 'Enter');
    await typeKeys('T');
    const fifth = await wait(() => artOf(note.querySelectorAll(':scope > p')[4]), 'new paragraph cap');
    assert(fifth.dataset.state === 'assembling' || !fifth.dataset.state, `A new paragraph's cap assembles from its first letter (${fifth.dataset.state})`);
    await typeKeys('ypewriter keys struck the page.');
    await delay(100);
    const typed = note.querySelectorAll(':scope > p')[4].textContent;
    assert(typed === 'Typewriter keys struck the page.', `Typing a new paragraph key by key keeps every letter (“${typed}”)`);
    assert(getComputedStyle(note.querySelectorAll(':scope > p')[4]).color !== 'rgba(0, 0, 0, 0)', 'The new paragraph’s words are visible beside its cap');
    metrics.capReplacedWhileTyping = !fifth.isConnected;
    await wait(() => artOf(note.querySelectorAll(':scope > p')[4])?.dataset.state === 'settled', 'new cap settled');
    assert(paragraphs.every((p, i) => artOf(p) === before4[i]), 'Earlier caps are kept, not redrawn from scratch');
    key(note, 'z', 'KeyZ', { metaKey: true });
    for (let i = 0; i < 40 && note.querySelectorAll(':scope > p').length > 4 && note.querySelectorAll(':scope > p')[4].textContent !== ''; i++) { key(note, 'z', 'KeyZ', { metaKey: true }); await delay(40); }
    await wait(() => note.querySelectorAll(':scope > p').length === 4 || note.querySelectorAll(':scope > p')[4]?.textContent === '', 'undo new paragraph');
    await frame(); await frame();
    const afterUndo = [...note.querySelectorAll(':scope > p')].filter(p => /\S/.test(p.textContent)).map(p => artOf(p)?.dataset.state);
    metrics.courierCapsAfterUndo = afterUndo;
    assert(afterUndo.length === 4 && afterUndo.every(state => state !== 'assembling'), `Undo doesn't replay the drop caps (${afterUndo.join(',')})`);

    // Heading 1 and 2 are drawn in ASCII too; typed letters arrive one by one.
    const endOf = block => { const r = document.createRange(); r.selectNodeContents(block); r.collapse(false); note.focus(); getSelection().removeAllRanges(); getSelection().addRange(r); document.dispatchEvent(new Event('selectionchange')); };
    const lastBlock = () => note.querySelector(':scope > :last-child');
    const blocksBefore = note.children.length;
    endOf(note.querySelectorAll(':scope > p')[3]); await delay(80);
    // Type a line, then make it a heading with the toolbar's Heading level menu.
    const makeHeading = async (text, level) => {
      key(note, 'Enter', 'Enter');
      await typeKeys(text);
      // Let the note's selection settle, as it would before a person reaches the menu.
      document.dispatchEvent(new Event('selectionchange')); await delay(200);
      const levelMenu = [...document.querySelectorAll('select[aria-label="Heading level"]')].find(menu => menu.offsetParent && !menu.disabled);
      levelMenu.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      levelMenu.value = String(level);
      levelMenu.dispatchEvent(new Event('change', { bubbles: true }));
      let heading;
      try { heading = await wait(() => [...note.querySelectorAll(`:scope > h${level}`)].find(h => h.textContent === text), `heading ${level}`); }
      catch (error) {
        metrics.headingDebug = { menus: [...document.querySelectorAll('select[aria-label="Heading level"]')].map(m => ({ visible: !!m.offsetParent, disabled: m.disabled, value: m.value })),
          blocks: [...note.querySelectorAll(':scope > *')].map(b => `${b.tagName}:${JSON.stringify(b.textContent.slice(0, 30))}`), active: document.activeElement?.outerHTML?.slice(0, 120),
          toolbar: [...document.querySelectorAll('.writing-format-bar')].map(bar => bar.textContent.replace(/\s+/g, ' ').slice(0, 300)) };
        throw error;
      }
      endOf(heading); await delay(80);
      return heading;
    };
    const h1 = await makeHeading('Typewritten', 1);
    const h1Art = await wait(() => artOf(h1, '.ascii-heading'), 'heading art');
    assert(getComputedStyle(h1).color === 'rgba(0, 0, 0, 0)' && h1.textContent === 'Typewritten', 'Heading 1 text stays in place, transparent, under its ASCII art');
    await wait(() => h1Art.dataset.state === 'settled', 'heading art settled');
    const headingBox = h => { const r = h.getBoundingClientRect(), st = getComputedStyle(h); return { left: r.left + parseFloat(st.paddingLeft), top: r.top + parseFloat(st.paddingTop), width: h.clientWidth - parseFloat(st.paddingLeft) - parseFloat(st.paddingRight) }; };
    const artRect = h1Art.getBoundingClientRect(), box = headingBox(h1);
    assert(Math.max(Math.abs(artRect.left - box.left), Math.abs(artRect.top - box.top), Math.abs(artRect.width - box.width)) <= 1.5, 'The heading art covers the heading');
    const h1Ink = inked(h1Art.querySelector('canvas'));
    assert(h1Ink > 200, `Heading 1 is drawn in ASCII (${h1Ink} inked pixels)`);
    // Typing in a heading: only the new letters arrive, the rest stay put.
    await typeKeys(' Heading');
    await wait(() => h1.textContent === 'Typewritten Heading', 'heading text extended');
    const typing = await wait(() => artOf(h1)?.dataset.state === 'assembling' && artOf(h1), 'typed letters arriving');
    const arrivingNow = Number(typing.dataset.arriving), inkNow = Number(typing.dataset.ink);
    metrics.headingTyping = { arriving: arrivingNow, ink: inkNow };
    assert(arrivingNow > 0 && arrivingNow < inkNow * 0.6, `Typing in a heading animates only the new letters (${arrivingNow} of ${inkNow} cells)`);
    await wait(() => artOf(h1)?.dataset.state === 'settled', 'typed letters settled');
    assert(inked(artOf(h1).querySelector('canvas')) > h1Ink, 'The typed letters join the heading art');

    // Typing in a paragraph doesn't re-assemble its drop cap.
    endOf(note.querySelectorAll(':scope > p')[2]); await delay(80);
    document.execCommand('insertText', false, ' More words.');
    await delay(120);
    const capWhileTyping = artOf(note.querySelectorAll(':scope > p')[2]);
    assert(capWhileTyping?.dataset.state === 'settled' && capWhileTyping.dataset.arriving === '0', `Typing in a paragraph leaves its drop cap settled (${capWhileTyping?.dataset.state}, ${capWhileTyping?.dataset.arriving} arriving)`);
    key(note, 'z', 'KeyZ', { metaKey: true });
    await wait(() => !note.querySelectorAll(':scope > p')[2].textContent.endsWith('More words.'), 'undo typing');
    endOf(h1); await delay(80);

    const h2 = await makeHeading('Second level', 2);
    const h2Art = await wait(() => artOf(h2, '.ascii-heading'), 'heading 2 art');
    await wait(() => h2Art.dataset.state === 'settled', 'heading 2 settled');
    assert(inked(h2Art.querySelector('canvas')) > 150 && getComputedStyle(h2).color === 'rgba(0, 0, 0, 0)', 'Heading 2 is drawn in ASCII');
    metrics.courierHeadings = { h1: [artOf(h1).querySelector('canvas').width, artOf(h1).querySelector('canvas').height, getComputedStyle(h1).fontSize], h2: getComputedStyle(h2).fontSize };
    try { await ipc('create_file', { path: `${notes.root}/courier-heading.txt` }); } catch { /* exists */ }
    await ipc('write_file', { path: `${notes.root}/courier-heading.txt`, content: artOf(h1).querySelector('canvas').toDataURL('image/png') });
    for (let i = 0; i < 12 && note.children.length > blocksBefore; i++) { key(note, 'z', 'KeyZ', { metaKey: true }); await delay(60); }
    await wait(() => note.children.length === blocksBefore && !note.querySelector(':scope > h1, :scope > h2'), 'headings undone');
    assert(note.querySelectorAll(':scope > p')[0].textContent === prose, 'Undo removes the headings and leaves the note as it was');

    // The spread parts the text around the cap.
    const courierFirst = note.querySelector(':scope > p');
    courierFirst.scrollIntoView({ block: 'center' }); await delay(150);
    const courierBefore = words(courierFirst);
    const courierLines = lines(courierBefore);
    const capRect = capBoxOf(courierFirst);
    for (const lineIndex of [0, 1, 2]) {
      const target = courierBefore.filter(w => Math.abs(w.top - courierLines[lineIndex]) < 4 && /^[a-z]{4,}$/i.test(w.text))[1];
      if (!target) continue;
      window.__textMotion = undefined;
      assert(rightClick(target.left + target.width / 2, target.top + 4).defaultPrevented, `Courier: right-clicking “${target.text}” on line ${lineIndex + 1} opens the spread`);
      await wait(() => opening()?.classList.contains('is-visible') && window.__textMotion, 'courier spread settled');
      assert(window.__textMotion.reflowed, `Courier line ${lineIndex + 1}: the paragraph reflows (${window.__textMotion.fallback ?? 'ok'})`);
      const hole = opening().getBoundingClientRect();
      const clash = [...document.querySelectorAll('.text-motion-word')].filter(span => {
        const r = span.getBoundingClientRect();
        const hits = box => r.right > box.left + 1 && r.left < box.right - 1 && r.bottom > box.top + 1 && r.top < box.bottom - 1;
        return hits(hole) || hits(capRect);
      }).map(span => span.textContent);
      assert(!clash.length, `Courier line ${lineIndex + 1}: no word overlaps the opening or the drop cap (${clash.join(' ')})`);
      key(window, 'Escape', 'Escape');
      await closed();
    }
    await frame();
    let courierDrift = 0;
    words(courierFirst).forEach((w, i) => { courierDrift = Math.max(courierDrift, Math.abs(w.left - courierBefore[i].left), Math.abs(w.top - courierBefore[i].top)); });
    assert(courierDrift < 0.01, `Courier: Escape returns every word exactly (drift ${courierDrift}px)`);

    // Define on a paragraph's next-to-last line: the paragraph grows, and the
    // next paragraph's ASCII cap moves down with its words.
    const courierSecond = note.querySelectorAll(':scope > p')[1];
    const secondWordsBefore = words(courierSecond);
    const lastCourierLine = courierBefore.filter(w => Math.abs(w.top - courierLines.at(-2)) < 4 && /^[a-z]{5,}$/i.test(w.text));
    const courierDefine = lastCourierLine[Math.floor(lastCourierLine.length / 2)];
    window.__textMotion = undefined;
    rightClick(courierDefine.left + courierDefine.width / 2, courierDefine.top + 4);
    await wait(() => opening()?.classList.contains('is-visible') && window.__textMotion, 'courier define spread');
    window.__textMotion = undefined;
    [...opening().querySelectorAll('button')].find(b => b.textContent === 'Define').click();
    await wait(() => document.querySelector('.text-motion-definition') && window.__textMotion, 'courier definition settled');
    const secondArt = artOf(courierSecond);
    const capShift = Number((secondArt.style.transform.match(/translateY\(([-\d.]+)px\)/) ?? [])[1] ?? 0);
    const translateY = el => Number((el?.style.transform.match(/translate\([-\d.]+px, ([-\d.]+)px\)/) ?? [])[1] ?? 0);
    const wordShift = translateY([...document.querySelectorAll('.text-motion-word')].find(span => span.textContent === 'second'));
    metrics.courierNeighbourCap = { capShift, wordShift, paragraphs: window.__textMotion?.paragraphs };
    if (!document.querySelector('.text-motion-definition .empty')) {
      assert(capShift > 0 && Math.abs(capShift - wordShift) <= 1.5, `Courier: the next paragraph's ASCII cap moves with its words (${capShift.toFixed(1)}px, words ${wordShift.toFixed(1)}px)`);
      assert(inked(secondArt.querySelector('canvas')) > 50, 'Courier: the moving cap stays drawn during the spread');
    }
    key(window, 'Escape', 'Escape');
    await closed();
    await frame();
    assert(!secondArt.style.transform && Math.abs(words(courierSecond)[0].top - secondWordsBefore[0].top) < 0.01, 'Courier: the cap and its paragraph return exactly');

    // Back to None: the drop caps go away and the letters return to the line.
    footer('Settings');
    // Other settings (backgrounds) have a "None" too; use the writing-style group.
    const noneButton = await wait(() => [...document.querySelectorAll('.tab-content.is-active .settings-theme-btns')]
      .find(group => [...group.querySelectorAll('button')].some(b => b.textContent === 'Courier'))
      ?.querySelector('button'), 'None style button');
    assert(noneButton.textContent === 'None', 'The writing-style group starts with None');
    noneButton.click();
    noteTab.click();
    await wait(() => editor() === note && document.querySelector('.block-editor[data-writing-style="none"]'), 'None style applied');
    await frame(); await frame();
    assert(!note.querySelector('.ascii-art') && !note.querySelector('.drop-cap-letter'), 'Switching to None removes the drop caps and shows every letter');
    }

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
      motion: window.__textMotion, layer: layer()?.outerHTML?.slice(0, 4000), activeElement: document.activeElement?.outerHTML?.slice(0, 500),
      pageErrors, alerts: [...document.querySelectorAll('[role="alert"], .notification, .toast')].map(n => n.textContent.trim()).filter(Boolean) };
    try { await ipc('create_file', { path: reportPath }); } catch { /* Existing report. */ }
    await ipc('write_file', { path: reportPath, content: JSON.stringify(result, null, 2) });
  }
})();
