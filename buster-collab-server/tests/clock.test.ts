import { test, expect, describe } from "bun:test";
import { LamportClock, type LamportTimestamp } from "../src/clock.ts";

describe("LamportClock", () => {
  describe("tick", () => {
    test("starts at 0 and increments on tick", () => {
      const clock = new LamportClock("peer-A");
      expect(clock.value).toBe(0);

      const ts = clock.tick();
      expect(ts.value).toBe(1);
      expect(ts.peerId).toBe("peer-A");
      expect(clock.value).toBe(1);
    });

    test("increments monotonically on successive ticks", () => {
      const clock = new LamportClock("peer-A");
      const t1 = clock.tick();
      const t2 = clock.tick();
      const t3 = clock.tick();

      expect(t1.value).toBe(1);
      expect(t2.value).toBe(2);
      expect(t3.value).toBe(3);
    });

    test("accepts a custom initial value", () => {
      const clock = new LamportClock("peer-A", 100);
      const ts = clock.tick();
      expect(ts.value).toBe(101);
    });
  });

  describe("update", () => {
    test("advances past received value when local is lower", () => {
      const clock = new LamportClock("peer-A");
      clock.tick(); // value = 1

      const ts = clock.update(10);
      expect(ts.value).toBe(11); // max(1, 10) + 1
      expect(clock.value).toBe(11);
    });

    test("advances past local value when local is higher", () => {
      const clock = new LamportClock("peer-A", 20);

      const ts = clock.update(5);
      expect(ts.value).toBe(21); // max(20, 5) + 1
    });

    test("advances past equal values", () => {
      const clock = new LamportClock("peer-A", 7);

      const ts = clock.update(7);
      expect(ts.value).toBe(8); // max(7, 7) + 1
    });
  });

  describe("compare", () => {
    test("lower value comes first", () => {
      const a: LamportTimestamp = { value: 1, peerId: "Z" };
      const b: LamportTimestamp = { value: 5, peerId: "A" };

      expect(LamportClock.compare(a, b)).toBeLessThan(0);
      expect(LamportClock.compare(b, a)).toBeGreaterThan(0);
    });

    test("equal values use peerId tiebreak (lexicographic)", () => {
      const a: LamportTimestamp = { value: 3, peerId: "alpha" };
      const b: LamportTimestamp = { value: 3, peerId: "beta" };

      expect(LamportClock.compare(a, b)).toBeLessThan(0);
      expect(LamportClock.compare(b, a)).toBeGreaterThan(0);
    });

    test("identical timestamps compare as equal", () => {
      const a: LamportTimestamp = { value: 3, peerId: "same" };
      const b: LamportTimestamp = { value: 3, peerId: "same" };

      expect(LamportClock.compare(a, b)).toBe(0);
    });

    test("provides a total order across many timestamps", () => {
      const timestamps: LamportTimestamp[] = [
        { value: 5, peerId: "B" },
        { value: 1, peerId: "A" },
        { value: 3, peerId: "C" },
        { value: 3, peerId: "A" },
        { value: 5, peerId: "A" },
      ];

      const sorted = [...timestamps].sort(LamportClock.compare);

      // Expected order: (1,A), (3,A), (3,C), (5,A), (5,B)
      expect(sorted[0]).toEqual({ value: 1, peerId: "A" });
      expect(sorted[1]).toEqual({ value: 3, peerId: "A" });
      expect(sorted[2]).toEqual({ value: 3, peerId: "C" });
      expect(sorted[3]).toEqual({ value: 5, peerId: "A" });
      expect(sorted[4]).toEqual({ value: 5, peerId: "B" });
    });
  });

  describe("multi-peer interaction", () => {
    test("two clocks converge after message exchange", () => {
      const clockA = new LamportClock("A");
      const clockB = new LamportClock("B");

      const a1 = clockA.tick(); // A: 1
      const a2 = clockA.tick(); // A: 2

      // B receives A's latest
      const b1 = clockB.update(a2.value); // B: max(0,2)+1 = 3

      // A receives B's response
      const a3 = clockA.update(b1.value); // A: max(2,3)+1 = 4

      expect(a3.value).toBe(4);
      expect(clockA.value).toBeGreaterThan(clockB.value);
    });
  });
});
