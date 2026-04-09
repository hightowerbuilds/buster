import { test, expect, describe } from "bun:test";
import { transform, applyOp, type InsertOp, type DeleteOp } from "../src/crdt.ts";

describe("applyOp", () => {
  test("insert at beginning", () => {
    const op: InsertOp = { type: "insert", position: 0, text: "hello ", siteId: "A", timestamp: 1 };
    expect(applyOp("world", op)).toBe("hello world");
  });

  test("insert at end", () => {
    const op: InsertOp = { type: "insert", position: 5, text: "!", siteId: "A", timestamp: 1 };
    expect(applyOp("hello", op)).toBe("hello!");
  });

  test("delete from middle", () => {
    const op: DeleteOp = { type: "delete", position: 5, length: 6, siteId: "A", timestamp: 1 };
    expect(applyOp("hello world", op)).toBe("hello");
  });
});

describe("transform", () => {
  test("insert-insert: earlier position wins", () => {
    const a: InsertOp = { type: "insert", position: 2, text: "X", siteId: "A", timestamp: 1 };
    const b: InsertOp = { type: "insert", position: 5, text: "Y", siteId: "B", timestamp: 1 };

    const aPrime = transform(a, b);
    expect(aPrime.type).toBe("insert");
    expect((aPrime as InsertOp).position).toBe(2); // before b, unchanged
  });

  test("insert-insert: later position shifted", () => {
    const a: InsertOp = { type: "insert", position: 5, text: "X", siteId: "A", timestamp: 1 };
    const b: InsertOp = { type: "insert", position: 2, text: "YZ", siteId: "B", timestamp: 1 };

    const aPrime = transform(a, b);
    expect((aPrime as InsertOp).position).toBe(7); // shifted by "YZ".length
  });

  test("insert-insert: same position uses siteId tiebreak", () => {
    const a: InsertOp = { type: "insert", position: 3, text: "X", siteId: "A", timestamp: 1 };
    const b: InsertOp = { type: "insert", position: 3, text: "Y", siteId: "B", timestamp: 1 };

    const aPrime = transform(a, b);
    expect((aPrime as InsertOp).position).toBe(3); // A < B, A wins position
  });

  test("insert-delete: insert before deletion", () => {
    const a: InsertOp = { type: "insert", position: 2, text: "X", siteId: "A", timestamp: 1 };
    const b: DeleteOp = { type: "delete", position: 5, length: 3, siteId: "B", timestamp: 1 };

    const aPrime = transform(a, b);
    expect((aPrime as InsertOp).position).toBe(2); // unchanged
  });

  test("insert-delete: insert after deletion shifts back", () => {
    const a: InsertOp = { type: "insert", position: 8, text: "X", siteId: "A", timestamp: 1 };
    const b: DeleteOp = { type: "delete", position: 2, length: 3, siteId: "B", timestamp: 1 };

    const aPrime = transform(a, b);
    expect((aPrime as InsertOp).position).toBe(5); // shifted back by 3
  });

  test("delete-insert: delete before insertion unchanged", () => {
    const a: DeleteOp = { type: "delete", position: 1, length: 2, siteId: "A", timestamp: 1 };
    const b: InsertOp = { type: "insert", position: 5, text: "XY", siteId: "B", timestamp: 1 };

    const aPrime = transform(a, b);
    expect((aPrime as DeleteOp).position).toBe(1);
    expect((aPrime as DeleteOp).length).toBe(2);
  });

  test("delete-insert: delete after insertion shifts forward", () => {
    const a: DeleteOp = { type: "delete", position: 5, length: 2, siteId: "A", timestamp: 1 };
    const b: InsertOp = { type: "insert", position: 2, text: "XYZ", siteId: "B", timestamp: 1 };

    const aPrime = transform(a, b);
    expect((aPrime as DeleteOp).position).toBe(8); // shifted by 3
  });

  test("convergence: concurrent inserts produce same result", () => {
    const doc = "hello";
    const a: InsertOp = { type: "insert", position: 2, text: "X", siteId: "A", timestamp: 1 };
    const b: InsertOp = { type: "insert", position: 4, text: "Y", siteId: "B", timestamp: 1 };

    // Path 1: apply A, then B transformed against A
    const bPrime = transform(b, a);
    const path1 = applyOp(applyOp(doc, a), bPrime);

    // Path 2: apply B, then A transformed against B
    const aPrime = transform(a, b);
    const path2 = applyOp(applyOp(doc, b), aPrime);

    expect(path1).toBe(path2); // convergence!
  });
});
