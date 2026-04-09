import { test, expect, describe } from "bun:test";
import { Document } from "../src/document.ts";
import type { InsertOp, DeleteOp } from "../src/crdt.ts";

describe("Document", () => {
  test("starts with initial content", () => {
    const doc = new Document("test", "hello world");
    expect(doc.getContent()).toBe("hello world");
    expect(doc.getVersion()).toBe(0);
  });

  test("applies insert operation", () => {
    const doc = new Document("test", "hello");
    const op: InsertOp = { type: "insert", position: 5, text: " world", siteId: "A", timestamp: 1 };
    doc.applyOperation(op, 0);
    expect(doc.getContent()).toBe("hello world");
    expect(doc.getVersion()).toBe(1);
  });

  test("applies delete operation", () => {
    const doc = new Document("test", "hello world");
    const op: DeleteOp = { type: "delete", position: 5, length: 6, siteId: "A", timestamp: 1 };
    doc.applyOperation(op, 0);
    expect(doc.getContent()).toBe("hello");
  });

  test("transforms concurrent operations", () => {
    const doc = new Document("test", "hello");

    // Client A inserts at position 2, seeing version 0
    const opA: InsertOp = { type: "insert", position: 2, text: "X", siteId: "A", timestamp: 1 };
    doc.applyOperation(opA, 0);

    // Client B inserts at position 4, also seeing version 0
    // Server should transform B against A
    const opB: InsertOp = { type: "insert", position: 4, text: "Y", siteId: "B", timestamp: 2 };
    const transformed = doc.applyOperation(opB, 0);

    expect(doc.getContent()).toBe("heXllYo");
    expect(doc.getVersion()).toBe(2);
  });

  test("peer management", () => {
    const doc = new Document("test");
    doc.setPeer({ siteId: "A", name: "Alice", cursorPosition: 5, lastSeen: Date.now() });
    doc.setPeer({ siteId: "B", name: "Bob", cursorPosition: 10, lastSeen: Date.now() });

    expect(doc.getPeers().length).toBe(2);

    doc.removePeer("A");
    expect(doc.getPeers().length).toBe(1);
    expect(doc.getPeers()[0]!.name).toBe("Bob");
  });

  test("operations replay for reconnection", () => {
    const doc = new Document("test", "hello");
    const op1: InsertOp = { type: "insert", position: 5, text: "!", siteId: "A", timestamp: 1 };
    const op2: InsertOp = { type: "insert", position: 0, text: ">", siteId: "B", timestamp: 2 };

    doc.applyOperation(op1, 0);
    doc.applyOperation(op2, 1);

    const missed = doc.getOperationsSince(1);
    expect(missed.length).toBe(1);
  });

  test("snapshot", () => {
    const doc = new Document("test", "hello");
    doc.applyOperation(
      { type: "insert", position: 5, text: "!", siteId: "A", timestamp: 1 },
      0,
    );

    const snap = doc.snapshot();
    expect(snap.content).toBe("hello!");
    expect(snap.version).toBe(1);
  });
});
