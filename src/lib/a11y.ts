// ── Focus trap ──────────────────────────────────────────────────

/**
 * Creates a focus trap for modal dialogs.
 * - Traps Tab/Shift+Tab within the container
 * - Closes on Escape
 * - Restores focus to the previously focused element on close
 * - Auto-focuses the first focusable element on activation
 */
export function createFocusTrap(
  getContainer: () => HTMLElement | null | undefined,
  onClose: () => void,
) {
  let previousFocus: HTMLElement | null = null;

  const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

  function getFocusable(): HTMLElement[] {
    const el = getContainer();
    if (!el) return [];
    return Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (node) => !node.matches(":disabled") && node.offsetParent !== null,
    );
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }

    if (e.key !== "Tab") return;

    const focusable = getFocusable();
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  /** Call when the dialog opens. */
  function activate() {
    previousFocus = document.activeElement as HTMLElement | null;
    document.addEventListener("keydown", handleKeyDown, true);
    // Focus first focusable element after a frame (so the DOM is rendered)
    requestAnimationFrame(() => {
      const focusable = getFocusable();
      if (focusable.length > 0) focusable[0].focus();
    });
  }

  /** Call when the dialog closes. */
  function deactivate() {
    document.removeEventListener("keydown", handleKeyDown, true);
    if (previousFocus && previousFocus.isConnected) {
      previousFocus.focus();
    } else {
      // Fallback chain: next tab button → active editor → sidebar → nothing
      const nextTab = document.querySelector<HTMLElement>('.tab-bar .tab-btn');
      const editor = document.querySelector<HTMLElement>('.canvas-editor textarea');
      const sidebar = document.querySelector<HTMLElement>('.sidebar button');
      const target = nextTab ?? editor ?? sidebar;
      if (target) target.focus({ preventScroll: true });
    }
    previousFocus = null;
  }

  return { activate, deactivate };
}

// ── Live region ─────────────────────────────────────────────────

let liveRegion: HTMLElement | null = null;

function ensureLiveRegion(): HTMLElement {
  if (liveRegion) return liveRegion;
  liveRegion = document.createElement("div");
  liveRegion.id = "a11y-live-region";
  liveRegion.setAttribute("aria-live", "polite");
  liveRegion.setAttribute("aria-atomic", "true");
  liveRegion.setAttribute("role", "status");
  document.body.appendChild(liveRegion);
  return liveRegion;
}

/** Create a debounced version of announce(). */
export function createDebouncedAnnounce(
  delayMs: number,
  priority: "polite" | "assertive" = "polite",
): (text: string) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (text: string) => {
    clearTimeout(timer);
    timer = setTimeout(() => announce(text, priority), delayMs);
  };
}

/** Announce text to screen readers via an aria-live region. */
export function announce(text: string, priority: "polite" | "assertive" = "polite") {
  const region = ensureLiveRegion();
  region.setAttribute("aria-live", priority);
  // Clear and re-set to ensure announcement even for duplicate text
  region.textContent = "";
  requestAnimationFrame(() => {
    region.textContent = text;
  });
}
