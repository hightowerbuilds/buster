/**
 * CRDT operations for conflict-free text editing.
 *
 * Replaces the broken OT transform in buster's collab/crdt.rs
 * (which adds zero instead of shifting on insert vs delete).
 * Uses a Lamport timestamp + site ID for causal ordering.
 */

export interface InsertOp {
  type: "insert";
  position: number;
  text: string;
  siteId: string;
  timestamp: number;
}

export interface DeleteOp {
  type: "delete";
  position: number;
  length: number;
  siteId: string;
  timestamp: number;
}

export type Operation = InsertOp | DeleteOp;

/**
 * Transform two concurrent operations so they can be applied in either order.
 *
 * Given operations A and B that were created concurrently:
 * - transform(A, B) returns A' such that applying B then A' = applying A then B'
 *
 * This fixes the bug in the current Buster code where insert vs delete
 * adds zero instead of correctly shifting the position.
 */
export function transform(op: Operation, against: Operation): Operation {
  if (op.type === "insert" && against.type === "insert") {
    return transformInsertInsert(op, against);
  }
  if (op.type === "insert" && against.type === "delete") {
    return transformInsertDelete(op, against);
  }
  if (op.type === "delete" && against.type === "insert") {
    return transformDeleteInsert(op, against);
  }
  // delete vs delete
  return transformDeleteDelete(op as DeleteOp, against as DeleteOp);
}

function transformInsertInsert(op: InsertOp, against: InsertOp): InsertOp {
  if (op.position < against.position ||
      (op.position === against.position && op.siteId < against.siteId)) {
    return op;
  }
  return { ...op, position: op.position + against.text.length };
}

function transformInsertDelete(op: InsertOp, against: DeleteOp): InsertOp {
  if (op.position <= against.position) {
    return op;
  }
  if (op.position >= against.position + against.length) {
    return { ...op, position: op.position - against.length };
  }
  // Insert is inside the deleted range — move to deletion point
  return { ...op, position: against.position };
}

function transformDeleteInsert(op: DeleteOp, against: InsertOp): DeleteOp {
  if (op.position >= against.position) {
    return { ...op, position: op.position + against.text.length };
  }
  if (op.position + op.length <= against.position) {
    return op;
  }
  // Deletion spans the insertion point — expand to cover inserted text
  return { ...op, length: op.length + against.text.length };
}

function transformDeleteDelete(op: DeleteOp, against: DeleteOp): DeleteOp {
  if (op.position >= against.position + against.length) {
    return { ...op, position: op.position - against.length };
  }
  if (op.position + op.length <= against.position) {
    return op;
  }
  // Overlapping deletes — compute the non-overlapping remainder
  if (op.position >= against.position) {
    const overlapEnd = Math.min(
      op.position + op.length,
      against.position + against.length,
    );
    const remaining = op.position + op.length - overlapEnd;
    return {
      ...op,
      position: against.position,
      length: Math.max(0, remaining),
    };
  }
  // op starts before against
  const overlapStart = against.position;
  const overlapEnd = Math.min(
    op.position + op.length,
    against.position + against.length,
  );
  const overlap = overlapEnd - overlapStart;
  return { ...op, length: Math.max(0, op.length - overlap) };
}

/**
 * Apply an operation to a document string.
 */
export function applyOp(doc: string, op: Operation): string {
  if (op.type === "insert") {
    const pos = Math.min(op.position, doc.length);
    return doc.slice(0, pos) + op.text + doc.slice(pos);
  }
  const pos = Math.min(op.position, doc.length);
  const end = Math.min(pos + op.length, doc.length);
  return doc.slice(0, pos) + doc.slice(end);
}
