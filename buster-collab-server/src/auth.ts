/**
 * Authentication layer with workspace-scoped tokens.
 *
 * Tokens use a JWT-like structure: base64(header).base64(payload).base64(signature)
 * where the signature is HMAC-SHA256 over `header.payload` using a server secret.
 */

const encoder = new TextEncoder();

interface TokenHeader {
  alg: "HS256";
  typ: "COLLAB";
}

interface TokenPayload {
  workspaceId: string;
  peerId: string;
  exp: number; // milliseconds since epoch
  iat: number;
}

export interface TokenClaims {
  workspaceId: string;
  peerId: string;
}

function base64UrlEncode(data: string): string {
  return btoa(data).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(data: string): string {
  let s = data.replace(/-/g, "+").replace(/_/g, "/");
  // Pad to multiple of 4
  while (s.length % 4 !== 0) {
    s += "=";
  }
  return atob(s);
}

async function hmacSign(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  // Convert ArrayBuffer to base64url
  const bytes = new Uint8Array(sig);
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return base64UrlEncode(binary);
}

async function hmacVerify(
  secret: string,
  message: string,
  signature: string,
): Promise<boolean> {
  const expected = await hmacSign(secret, message);
  // Constant-time comparison
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}

export class AuthManager {
  private readonly secret: string;

  constructor(secret?: string) {
    this.secret = secret ?? (process.env.COLLAB_SECRET || "buster-collab-default-secret");
  }

  /**
   * Generate a token scoped to a workspace and peer.
   *
   * @param workspaceId - The workspace this token grants access to
   * @param peerId - The peer identity
   * @param expiresInMs - Time until expiry in milliseconds (default: 24 hours)
   */
  async generateToken(
    workspaceId: string,
    peerId: string,
    expiresInMs: number = 24 * 60 * 60 * 1000,
  ): Promise<string> {
    const header: TokenHeader = { alg: "HS256", typ: "COLLAB" };
    const now = Date.now();
    const payload: TokenPayload = {
      workspaceId,
      peerId,
      iat: now,
      exp: now + expiresInMs,
    };

    const headerB64 = base64UrlEncode(JSON.stringify(header));
    const payloadB64 = base64UrlEncode(JSON.stringify(payload));
    const signingInput = `${headerB64}.${payloadB64}`;
    const signature = await hmacSign(this.secret, signingInput);

    return `${headerB64}.${payloadB64}.${signature}`;
  }

  /**
   * Validate a token and return its claims.
   *
   * @throws Error if the token is malformed, the signature is invalid, or the token has expired.
   */
  async validateToken(token: string): Promise<TokenClaims> {
    const parts = token.split(".");
    if (parts.length !== 3) {
      throw new Error("Malformed token: expected 3 parts");
    }

    const [headerB64, payloadB64, signature] = parts as [string, string, string];
    const signingInput = `${headerB64}.${payloadB64}`;

    // Verify signature
    const valid = await hmacVerify(this.secret, signingInput, signature);
    if (!valid) {
      throw new Error("Invalid token signature");
    }

    // Decode and validate payload
    let payload: TokenPayload;
    try {
      payload = JSON.parse(base64UrlDecode(payloadB64));
    } catch {
      throw new Error("Malformed token payload");
    }

    // Check expiry
    if (payload.exp <= Date.now()) {
      throw new Error("Token has expired");
    }

    return {
      workspaceId: payload.workspaceId,
      peerId: payload.peerId,
    };
  }
}
