/**
 * Focus management service — centralizes DOM-query-based focus logic.
 *
 * Extracted from App.tsx to reduce UI policy in the root component.
 * Tab activation focuses immediately once its DOM is mounted. Waiting for a
 * paint lets the next native keystroke land on the button that opened the note.
 */

const FOCUSABLE = 'textarea:not([disabled]), input:not([disabled]), button:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
let focusRequest = 0;

/** Focus the content area of a tab panel by its ID. */
export function focusTabPanel(tabId: string): void {
  const request = ++focusRequest;
  const focus = () => {
    if (request !== focusRequest) return true;
    const panel = Array.from(document.querySelectorAll<HTMLElement>("[data-tab-panel-id]"))
      .find((el) => el.dataset.tabPanelId === tabId);
    if (!panel) return false;

    const target =
      panel.querySelector<HTMLElement>('[data-tab-focus-target="true"]') ??
      panel.querySelector<HTMLElement>(FOCUSABLE);

    if (!target?.isConnected || !target.getClientRects().length) return false;
    if (document.activeElement !== target) {
      target.focus({ preventScroll: true });
    }
    return document.activeElement === target;
  };
  if (focus()) return;
  // A surrounding Solid batch may still be publishing the new pane. Retry
  // before the browser can deliver the next input event, with one frame fallback
  // only for a panel whose DOM genuinely is not ready yet.
  queueMicrotask(() => {
    if (!focus()) requestAnimationFrame(focus);
  });
}

/** Focus the first focusable element in the sidebar. */
export function focusSidebarPrimary(): void {
  const request = ++focusRequest;
  requestAnimationFrame(() => {
    if (request !== focusRequest) return;
    const target = document.querySelector<HTMLElement>(`.sidebar button, .sidebar [tabindex]:not([tabindex='-1'])`);
    if (target && document.activeElement !== target) {
      target.focus({ preventScroll: true });
    }
  });
}

/** Restore focus to the active tab panel, or fall back to the IDE root element. */
export function restorePrimaryWorkspaceFocus(activeTabId: string | null, ideRoot?: HTMLElement): void {
  if (activeTabId) {
    focusTabPanel(activeTabId);
    return;
  }

  const request = ++focusRequest;
  requestAnimationFrame(() => {
    if (request !== focusRequest) return;
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    ideRoot?.focus({ preventScroll: true });
  });
}

/** Check if the sidebar currently has focus. */
export function sidebarHasFocus(): boolean {
  const sidebarWrap = document.querySelector<HTMLElement>(".sidebar-wrap");
  const active = document.activeElement;
  return !!active && !!sidebarWrap?.contains(active);
}
