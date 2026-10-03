import { describe, expect, it, vi } from "vitest";
import { createAppCloseHandler, isAppCloseShortcut } from "./app-lifecycle";

describe("app closing", () => {
  it("leaves Command W to Mac tabs, including the last tab, while Command Q quits", () => {
    const event = { key: "w", metaKey: true, ctrlKey: false, altKey: false, shiftKey: false };
    expect(isAppCloseShortcut(event, true)).toBe(false);
    expect(isAppCloseShortcut({ ...event, key: "W" }, true)).toBe(false);
    expect(isAppCloseShortcut({ ...event, key: "q" }, true)).toBe(true);
    expect(isAppCloseShortcut({ ...event, key: "q", metaKey: false, ctrlKey: true }, true)).toBe(true);
  });

  it("recognizes Command/Super W and Q and Control Q, leaving Control W to tabs", () => {
    const event = { key: "w", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false };
    for (const key of ["w", "W", "q", "Q"]) expect(isAppCloseShortcut({ ...event, key, metaKey: true })).toBe(true);
    expect(isAppCloseShortcut({ ...event, key: "q", ctrlKey: true })).toBe(true);
    expect(isAppCloseShortcut({ ...event, ctrlKey: true })).toBe(false);
    expect(isAppCloseShortcut(event)).toBe(false);
    expect(isAppCloseShortcut({ ...event, metaKey: true, shiftKey: true })).toBe(false);
  });

  it("waits for durable saving and collapses repeated requests", async () => {
    let finish!: () => void;
    const save = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const close = vi.fn(async () => {});
    const handler = createAppCloseHandler(save, close, vi.fn());
    const pending = handler();
    await handler();
    expect(save).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
    finish();
    await pending;
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("keeps the app open on save failure and allows retry", async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error("disk full")).mockResolvedValue(undefined);
    const close = vi.fn(async () => {});
    const report = vi.fn();
    const handler = createAppCloseHandler(save, close, report);
    await handler();
    expect(close).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledOnce();
    await handler();
    expect(close).toHaveBeenCalledOnce();
  });
});
