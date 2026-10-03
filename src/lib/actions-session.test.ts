import { describe, expect, it, vi } from "vitest";
import { createSessionActions } from "./actions-session";
import type { BusterStoreState } from "./store-types";
import type { EngineMap } from "./buster-context";
import { persistSession } from "./session";

vi.mock("./session", () => ({ persistSession: vi.fn(async () => {}) }));
vi.mock("./notify", () => ({ logWarn: vi.fn() }));

describe("session recovery save gate", () => {
  it("blocks closing before recovery succeeds without publishing an empty session", async () => {
    vi.mocked(persistSession).mockClear();
    const actions = createSessionActions({ tabs: [], fileTexts: {}, scrollPositions: {} } as unknown as BusterStoreState,
      { map: new Map() } as EngineMap);
    await actions.saveSessionNow();
    await expect(actions.saveSessionNow(true)).rejects.toThrow("recovery has not completed");
    expect(persistSession).not.toHaveBeenCalled();
    actions.finishSessionRestore();
    await actions.saveSessionNow(true);
    expect(persistSession).toHaveBeenCalledOnce();
  });
});
