/** Capture before editors so quitting works regardless of focus. */
export function isAppCloseShortcut(event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">, isMac = false): boolean {
  if (event.altKey || event.shiftKey) return false;
  const key = event.key.toLowerCase();
  return (event.metaKey && (key === "q" || (!isMac && key === "w"))) || (event.ctrlKey && key === "q");
}

/** Serialize repeated close requests and never exit after a failed backup. */
export function createAppCloseHandler(save: () => Promise<void>, close: () => Promise<void>, report: (error: unknown) => void) {
  let pending = false;
  return async () => {
    if (pending) return;
    pending = true;
    try {
      await save();
      await close();
    } catch (error) {
      report(error);
      pending = false;
    }
  };
}
