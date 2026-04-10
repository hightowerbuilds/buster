/**
 * WebSocket collaboration server using Bun.serve().
 *
 * Handles:
 * - Document sessions (join, leave)
 * - Operation broadcast to all peers
 * - Peer presence (cursor positions, selections)
 * - Reconnection with operation replay
 * - Auth via workspace-scoped tokens
 */

import { Document, type Peer } from "./document.ts";
import type { Operation } from "./crdt.ts";
import { AuthManager, type TokenClaims } from "./auth.ts";

interface ClientMessage {
  type: "join" | "operation" | "cursor" | "leave";
  documentId: string;
  siteId: string;
  name?: string;
  operation?: Operation;
  version?: number;
  cursor?: { position: number; selectionStart?: number; selectionEnd?: number };
}

interface ServerMessage {
  type: "joined" | "operation" | "cursor" | "peer_left" | "sync" | "error";
  documentId: string;
  siteId?: string;
  name?: string;
  operation?: Operation;
  version?: number;
  content?: string;
  peers?: Peer[];
  cursor?: { position: number; selectionStart?: number; selectionEnd?: number };
  message?: string;
}

const documents = new Map<string, Document>();
const clientDocs = new Map<WebSocket, { documentId: string; siteId: string; workspaceId?: string }>();

function getOrCreateDocument(id: string, workspaceId?: string): Document {
  const key = workspaceId ? `${workspaceId}:${id}` : id;
  let doc = documents.get(key);
  if (!doc) {
    doc = new Document(id, "", workspaceId);
    documents.set(key, doc);
  }
  return doc;
}

/** Resolve the storage key for a document within a workspace. */
function docKey(documentId: string, workspaceId?: string): string {
  return workspaceId ? `${workspaceId}:${documentId}` : documentId;
}

export interface ServerOptions {
  port?: number;
  /** Set to `false` to disable auth (useful in tests). Defaults to `true`. */
  requireAuth?: boolean;
  /** Custom AuthManager instance. If not provided, one is created from env. */
  authManager?: AuthManager;
}

export function createServer(portOrOptions?: number | ServerOptions) {
  const opts: ServerOptions =
    typeof portOrOptions === "number"
      ? { port: portOrOptions }
      : portOrOptions ?? {};

  const port = opts.port ?? 3001;
  const requireAuth = opts.requireAuth ?? true;
  const auth = opts.authManager ?? new AuthManager();

  return Bun.serve({
    port,
    async fetch(req, server) {
      const url = new URL(req.url);

      if (url.pathname === "/health") {
        return new Response("ok", { status: 200 });
      }

      // --- Auth on upgrade ---
      if (requireAuth) {
        const token = url.searchParams.get("token") ?? req.headers.get("x-collab-token");
        if (!token) {
          return new Response("Missing auth token", { status: 401 });
        }
        let claims: TokenClaims;
        try {
          claims = await auth.validateToken(token);
        } catch (err: any) {
          return new Response(err.message ?? "Invalid token", { status: 403 });
        }
        // Attach claims to the WebSocket via upgrade data
        if (server.upgrade(req, { data: { claims } })) return;
      } else {
        if (server.upgrade(req)) return;
      }

      return new Response("Buster Collab Server", { status: 200 });
    },
    websocket: {
      open(ws: any) {
        // Client connects — no action until they join a document
      },
      message(ws: any, message: any) {
        try {
          const msg: ClientMessage = JSON.parse(message as string);
          const claims: TokenClaims | undefined = ws.data?.claims;
          handleMessage(ws, msg, claims);
        } catch {
          ws.send(JSON.stringify({ type: "error", message: "invalid message" }));
        }
      },
      close(ws: any) {
        const info = clientDocs.get(ws);
        if (info) {
          const key = docKey(info.documentId, info.workspaceId);
          const doc = documents.get(key);
          if (doc) {
            doc.removePeer(info.siteId);
            broadcastToDocument(key, ws, {
              type: "peer_left",
              documentId: info.documentId,
              siteId: info.siteId,
            });
          }
          clientDocs.delete(ws);
        }
      },
    },
  });
}

function handleMessage(ws: WebSocket, msg: ClientMessage, claims?: TokenClaims) {
  const workspaceId = claims?.workspaceId;
  const key = docKey(msg.documentId, workspaceId);

  switch (msg.type) {
    case "join": {
      const doc = getOrCreateDocument(msg.documentId, workspaceId);
      clientDocs.set(ws, { documentId: msg.documentId, siteId: msg.siteId, workspaceId });

      doc.setPeer({
        siteId: msg.siteId,
        name: msg.name ?? msg.siteId,
        cursorPosition: 0,
        lastSeen: Date.now(),
      });

      // Send current state to the joining client
      const response: ServerMessage = {
        type: "sync",
        documentId: msg.documentId,
        content: doc.getContent(),
        version: doc.getVersion(),
        peers: doc.getPeers(),
      };
      ws.send(JSON.stringify(response));

      // Broadcast join to others
      broadcastToDocument(key, ws, {
        type: "joined",
        documentId: msg.documentId,
        siteId: msg.siteId,
        name: msg.name,
      });
      break;
    }

    case "operation": {
      if (!msg.operation || msg.version === undefined) return;
      const doc = documents.get(key);
      if (!doc) return;

      // Reject if the document's workspace doesn't match the token's workspace
      if (workspaceId && doc.workspaceId && doc.workspaceId !== workspaceId) {
        ws.send(JSON.stringify({
          type: "error",
          documentId: msg.documentId,
          message: "workspace mismatch",
        }));
        return;
      }

      const transformed = doc.applyOperation(msg.operation, msg.version);

      broadcastToDocument(key, ws, {
        type: "operation",
        documentId: msg.documentId,
        siteId: msg.siteId,
        operation: transformed,
        version: doc.getVersion(),
      });
      break;
    }

    case "cursor": {
      if (!msg.cursor) return;
      const doc = documents.get(key);
      if (!doc) return;

      doc.setPeer({
        siteId: msg.siteId,
        name: msg.name ?? msg.siteId,
        cursorPosition: msg.cursor.position,
        selectionStart: msg.cursor.selectionStart,
        selectionEnd: msg.cursor.selectionEnd,
        lastSeen: Date.now(),
      });

      broadcastToDocument(key, ws, {
        type: "cursor",
        documentId: msg.documentId,
        siteId: msg.siteId,
        cursor: msg.cursor,
      });
      break;
    }

    case "leave": {
      const doc = documents.get(key);
      if (doc) {
        doc.removePeer(msg.siteId);
      }
      clientDocs.delete(ws);
      broadcastToDocument(key, ws, {
        type: "peer_left",
        documentId: msg.documentId,
        siteId: msg.siteId,
      });
      break;
    }
  }
}

function broadcastToDocument(
  key: string,
  exclude: WebSocket,
  message: ServerMessage,
) {
  const json = JSON.stringify(message);
  for (const [client, info] of clientDocs) {
    const clientKey = docKey(info.documentId, info.workspaceId);
    if (clientKey === key && client !== exclude) {
      client.send(json);
    }
  }
}

// Start the server if run directly
if (import.meta.main) {
  const port = Number(process.env.PORT) || 3001;
  const server = createServer(port);
  console.log(`Buster Collab Server running on port ${port}`);
}

export { documents, clientDocs };
