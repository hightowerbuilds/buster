# BusterMark Phase 0 demo

This demonstrates the retained application and the rebuild foundation. The
tmux-like note panes, selection action menu, AI revision review, and voice/model
interface remain Phase 1 work.

1. Launch `BusterMark.app`. The window and status bar show the new name; an empty
   workspace identifies it as a writing workbench with AI.
2. Use File → New File twice. Type different text into each draft. Switch between
   them with Cmd+1 and Cmd+2; both retain their own unsaved text.
3. Open the internal command line with Ctrl+backtick. Run `app status`, `help`,
   and `document list`. Use `document read {"tabId":"file_1"}` with an ID from
   the list to inspect live draft text. Escape returns to the writing surface.
4. Run `terminal create` in the app command line, or press Cmd+T. In the shell,
   run `printf 'BusterMark terminal ready\n'`. Terminal shell commands and app
   feature commands have separate entry points.
5. In the terminal, use Cmd+A/C to select/copy output, Cmd+V to paste, and Cmd+F
   to search. Escape closes search. Resize the window to exercise the PTY resize.
6. Save a draft as `.md`. Two spaces at the end of a line remain intact for
   Markdown hard breaks. Save errors leave writing open and dirty.

The isolated development smoke session additionally verified two unsaved drafts
surviving a process restart after their periodic backups completed. Do not use a
forced restart as an everyday save workflow. Recovery is periodic; explicit Save
remains the way to persist a named document immediately.

Verification and remaining limitations are recorded in the
[build log](2026-09-20-phase-0.md). Desktop captures contain only the isolated test
window and sample writing:

- [Internal command result and terminal output](assets/phase-0-command.png)
- [First recovered draft via live document read](assets/phase-0-recovered-first.png)
- [Second recovered draft in the editor](assets/phase-0-recovered-second.png)

- [Terminal search UI; burst scrollback issue remains](assets/phase-0-terminal-search.png)
