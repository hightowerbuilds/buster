/**
 * Server-side document state with operation log and versioning.
 */

import { type Operation, applyOp, transform } from "./crdt.ts";
import { LamportClock, type LamportTimestamp } from "./clock.ts";

export interface Peer {
  siteId: string;
  name: string;
  cursorPosition: number;
  selectionStart?: number;
  selectionEnd?: number;
  lastSeen: number;
}

export class Document {
  readonly id: string;
  /** Optional workspace scope — set when the document is created in an auth context. */
  workspaceId?: string;
  private content: string;
  private operations: Operation[] = [];
  private version = 0;
  private peers = new Map<string, Peer>();
  private clock: LamportClock;

  constructor(id: string, initialContent = "", workspaceId?: string) {
    this.id = id;
    this.content = initialContent;
    this.workspaceId = workspaceId;
    this.clock = new LamportClock(`server:${id}`);
  }

  /** Apply an operation from a client. Returns the transformed operation to broadcast. */
  applyOperation(op: Operation, clientVersion: number): Operation {
    // Update the server clock from the incoming lamport timestamp
    if (op.lamport) {
      this.clock.update(op.lamport.value);
    }

    // Transform against all operations the client hasn't seen
    let transformed = op;
    for (let i = clientVersion; i < this.operations.length; i++) {
      transformed = transform(transformed, this.operations[i]!);
    }

    // Stamp with the server's Lamport clock
    const ts = this.clock.tick();
    transformed = { ...transformed, lamport: ts };

    // Apply to document
    this.content = applyOp(this.content, transformed);

    // Insert into the log maintaining causal order (by Lamport timestamp)
    this.insertCausallyOrdered(transformed);
    this.version++;

    return transformed;
  }

  /** Insert an operation into the log in causal (Lamport) order. */
  private insertCausallyOrdered(op: Operation): void {
    if (!op.lamport) {
      // No timestamp — just append (backward compat)
      this.operations.push(op);
      return;
    }
    // Walk backward to find the correct insertion point
    let i = this.operations.length;
    while (i > 0) {
      const prev = this.operations[i - 1]!;
      if (!prev.lamport || LamportClock.compare(prev.lamport, op.lamport!) <= 0) {
        break;
      }
      i--;
    }
    this.operations.splice(i, 0, op);
  }

  /** Get current document content. */
  getContent(): string {
    return this.content;
  }

  /** Get current version number. */
  getVersion(): number {
    return this.version;
  }

  /** Get operations since a given version (for reconnection replay). */
  getOperationsSince(version: number): Operation[] {
    return this.operations.slice(version);
  }

  /** Add or update a peer. */
  setPeer(peer: Peer): void {
    this.peers.set(peer.siteId, peer);
  }

  /** Remove a peer. */
  removePeer(siteId: string): void {
    this.peers.delete(siteId);
  }

  /** Get all connected peers. */
  getPeers(): Peer[] {
    return Array.from(this.peers.values());
  }

  /** Create a snapshot for large operation histories. */
  snapshot(): { content: string; version: number } {
    return { content: this.content, version: this.version };
  }

  /** Compact operation history (keep only recent ops). */
  compact(keepRecent = 1000): void {
    if (this.operations.length > keepRecent) {
      this.operations = this.operations.slice(-keepRecent);
    }
  }
}
