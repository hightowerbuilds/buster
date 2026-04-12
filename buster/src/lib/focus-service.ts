/**
 * Focus management service — centralizes DOM-query-based focus logic.
 *
 * Extracted from App.tsx to reduce UI policy in the root component.
 * All focus operations use requestAnimationFrame to wait for DOM updates.
 */

const FOCUSABLE = 'textarea:not([disabled]), input:not([disabled]), button:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Focus the content area of a tab panel by its ID. */
export function focusTabPanel(tabId: string): void {
  requestAnimationFrame(() => {
    const panel = Array.from(document.querySelectorAll<HTMLElement>("[data-tab-panel-id]"))
      .find((el) => el.dataset.tabPanelId === tabId);
    if (!panel) return;

    const target =
      panel.querySelector<HTMLElement>('[data-tab-focus-target="true"]') ??
      panel.querySelector<HTMLElement>(FOCUSABLE);

    if (target && document.activeElement !== target) {
      target.focus({ preventScroll: true });
    }
  });
}

/** Focus the first focusable element in the sidebar. */
export function focusSidebarPrimary(): void {
  requestAnimationFrame(() => {
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

  requestAnimationFrame(() => {
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
