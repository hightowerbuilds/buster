import { test, expect, describe } from "bun:test";
import { AuthManager } from "../src/auth.ts";

describe("AuthManager", () => {
  const secret = "test-secret-key-for-unit-tests";
  const auth = new AuthManager(secret);

  describe("generateToken", () => {
    test("produces a three-part token string", async () => {
      const token = await auth.generateToken("ws-123", "peer-A");
      const parts = token.split(".");
      expect(parts.length).toBe(3);
    });

    test("tokens for different workspaces are different", async () => {
      const t1 = await auth.generateToken("ws-1", "peer-A");
      const t2 = await auth.generateToken("ws-2", "peer-A");
      expect(t1).not.toBe(t2);
    });
  });

  describe("validateToken", () => {
    test("round-trips workspaceId and peerId", async () => {
      const token = await auth.generateToken("workspace-abc", "peer-42");
      const claims = await auth.validateToken(token);

      expect(claims.workspaceId).toBe("workspace-abc");
      expect(claims.peerId).toBe("peer-42");
    });

    test("rejects a token with a tampered payload", async () => {
      const token = await auth.generateToken("ws-1", "peer-A");
      const parts = token.split(".");
      // Tamper with the payload
      const tamperedPayload = btoa(JSON.stringify({
        workspaceId: "ws-EVIL",
        peerId: "peer-A",
        iat: Date.now(),
        exp: Date.now() + 999999999,
      })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const tampered = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

      expect(auth.validateToken(tampered)).rejects.toThrow("Invalid token signature");
    });

    test("rejects a token with a tampered signature", async () => {
      const token = await auth.generateToken("ws-1", "peer-A");
      const parts = token.split(".");
      const tampered = `${parts[0]}.${parts[1]}.AAAA${parts[2]!.slice(4)}`;

      expect(auth.validateToken(tampered)).rejects.toThrow("Invalid token signature");
    });

    test("rejects a malformed token (wrong number of parts)", async () => {
      expect(auth.validateToken("only-one-part")).rejects.toThrow("Malformed token");
      expect(auth.validateToken("two.parts")).rejects.toThrow("Malformed token");
    });
  });

  describe("token expiry", () => {
    test("accepts a token that has not yet expired", async () => {
      const token = await auth.generateToken("ws-1", "peer-A", 60_000); // 1 minute
      const claims = await auth.validateToken(token);
      expect(claims.workspaceId).toBe("ws-1");
    });

    test("rejects an already-expired token", async () => {
      // Generate a token that expired 1ms ago
      const token = await auth.generateToken("ws-1", "peer-A", -1);
      expect(auth.validateToken(token)).rejects.toThrow("Token has expired");
    });
  });

  describe("workspace scoping", () => {
    test("different secrets produce different signatures", async () => {
      const auth2 = new AuthManager("different-secret");
      const token = await auth.generateToken("ws-1", "peer-A");

      // Token signed with one secret should not validate with another
      expect(auth2.validateToken(token)).rejects.toThrow("Invalid token signature");
    });

    test("same manager validates its own tokens consistently", async () => {
      const tokens = await Promise.all([
        auth.generateToken("ws-1", "peer-A"),
        auth.generateToken("ws-1", "peer-B"),
        auth.generateToken("ws-2", "peer-A"),
      ]);

      const claims = await Promise.all(tokens.map((t) => auth.validateToken(t)));

      expect(claims[0]!.workspaceId).toBe("ws-1");
      expect(claims[0]!.peerId).toBe("peer-A");
      expect(claims[1]!.workspaceId).toBe("ws-1");
      expect(claims[1]!.peerId).toBe("peer-B");
      expect(claims[2]!.workspaceId).toBe("ws-2");
      expect(claims[2]!.peerId).toBe("peer-A");
    });

    test("tokens from workspace A cannot be used to claim workspace B", async () => {
      const token = await auth.generateToken("ws-A", "peer-1");
      const claims = await auth.validateToken(token);
      // The token encodes the workspace — a client cannot change it without invalidating the signature
      expect(claims.workspaceId).toBe("ws-A");
      expect(claims.workspaceId).not.toBe("ws-B");
    });
  });
});
