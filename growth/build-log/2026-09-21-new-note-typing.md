# New notes: preserve the first keystroke

Status: **COMPLETED** — focus handoff fixed and regression checks passed.

Opening a note left focus on its creation button until the next animation frame.
Real mouse clicks followed immediately by typing reproduced `abcdefgh` becoming
`bcdefgh`: the initial `a` went to the button and never produced a text-input
event. Delayed file creation did not replace the editor or clear its text.

- [x] **COMPLETED** — Focus a mounted, visible tab input immediately. For a Solid
  batch still mounting the panel, retry in a microtask before the next input event.
  Use a single frame fallback only when the panel is still unavailable.
- [x] **COMPLETED** — Move editor activation/mount focus from animation frames to
  microtasks. Keep native text input and composition handling intact.
- [x] **COMPLETED** — Preserve request cancellation so a pending focus request
  cannot steal focus back after the user opens another panel.

## Verification

- TypeScript passed; **470 frontend tests in 42 files passed**, including four
  focus-handoff regressions and existing composition/note persistence tests.
- Unsigned macOS debug desktop build and app bundle completed successfully.
- [Before trace](assets/new-note-input-before.json) and
  [after trace](assets/new-note-input-after.json): all six original browser cases
  preserve every character after the fix. Covers footer and pane buttons, burst
  typing, and file creation delayed 500–1500 ms. Two further checks verify a rapid
  switch to Settings and the pane selector's change handler. These use the real
  App/Provider with mocked IPC; native dropdown popup selection was not asserted.
- [Native macOS WebKit trace](assets/new-note-native-input.json): the same app
  components focus the textarea before note creation returns, retain native
  `abcdefghij` typing through delayed file creation, and compose `é` exactly once.
  The native check uses an isolated WebKit window and mocked storage, leaving the
  user's app and notes untouched.
- Temporary browser fixtures and owned test processes were removed.
