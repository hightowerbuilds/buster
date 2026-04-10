/**
 * Lamport logical clock for causal ordering of CRDT operations.
 *
 * Each peer maintains its own clock. On every local event the clock ticks;
 * on every received event the clock is updated to max(local, received) + 1.
 * Ties are broken by lexicographic peer ID comparison so the ordering is total.
 */

export interface LamportTimestamp {
  value: number;
  peerId: string;
}

export class LamportClock {
  value: number;
  readonly peerId: string;

  constructor(peerId: string, initial = 0) {
    this.peerId = peerId;
    this.value = initial;
  }

  /** Increment the clock and return the new timestamp. */
  tick(): LamportTimestamp {
    this.value++;
    return { value: this.value, peerId: this.peerId };
  }

  /** Update the clock after receiving a remote timestamp. */
  update(received: number): LamportTimestamp {
    this.value = Math.max(this.value, received) + 1;
    return { value: this.value, peerId: this.peerId };
  }

  /**
   * Total-order comparison of two Lamport timestamps.
   *
   * Returns negative if `a` comes before `b`, positive if after, 0 if equal.
   * Value is compared first; ties are broken by peerId (lexicographic).
   */
  static compare(a: LamportTimestamp, b: LamportTimestamp): number {
    if (a.value !== b.value) {
      return a.value - b.value;
    }
    if (a.peerId < b.peerId) return -1;
    if (a.peerId > b.peerId) return 1;
    return 0;
  }
}
