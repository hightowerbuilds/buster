/**
 * Server-side document state with operation log and versioning.
 */

import { type Operation, applyOp, transform } from "./crdt.ts";

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
  private content: string;
  private operations: Operation[] = [];
  private version = 0;
  private peers = new Map<string, Peer>();

  constructor(id: string, initialContent = "") {
    this.id = id;
    this.content = initialContent;
  }

  /** Apply an operation from a client. Returns the transformed operation to broadcast. */
  applyOperation(op: Operation, clientVersion: number): Operation {
    // Transform against all operations the client hasn't seen
    let transformed = op;
    for (let i = clientVersion; i < this.operations.length; i++) {
      transformed = transform(transformed, this.operations[i]!);
    }

    // Apply to document
    this.content = applyOp(this.content, transformed);
    this.operations.push(transformed);
    this.version++;

    return transformed;
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
