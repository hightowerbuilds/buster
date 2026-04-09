/**
 * WebSocket collaboration server using Bun.serve().
 *
 * Handles:
 * - Document sessions (join, leave)
 * - Operation broadcast to all peers
 * - Peer presence (cursor positions, selections)
 * - Reconnection with operation replay
 */

import { Document, type Peer } from "./document.ts";
import type { Operation } from "./crdt.ts";

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
  type: "joined" | "operation" | "cursor" | "peer_left" | "sync";
  documentId: string;
  siteId?: string;
  name?: string;
  operation?: Operation;
  version?: number;
  content?: string;
  peers?: Peer[];
  cursor?: { position: number; selectionStart?: number; selectionEnd?: number };
}

const documents = new Map<string, Document>();
const clientDocs = new Map<WebSocket, { documentId: string; siteId: string }>();

function getOrCreateDocument(id: string): Document {
  let doc = documents.get(id);
  if (!doc) {
    doc = new Document(id);
    documents.set(id, doc);
  }
  return doc;
}

export function createServer(port = 3001) {
  return Bun.serve({
    port,
    fetch(req, server) {
      if (server.upgrade(req)) return;
      return new Response("Buster Collab Server", { status: 200 });
    },
    websocket: {
      open(ws) {
        // Client connects — no action until they join a document
      },
      message(ws, message) {
        try {
          const msg: ClientMessage = JSON.parse(message as string);
          handleMessage(ws, msg);
        } catch {
          ws.send(JSON.stringify({ type: "error", message: "invalid message" }));
        }
      },
      close(ws) {
        const info = clientDocs.get(ws);
        if (info) {
          const doc = documents.get(info.documentId);
          if (doc) {
            doc.removePeer(info.siteId);
            // Broadcast peer departure
            broadcastToDocument(info.documentId, ws, {
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

function handleMessage(ws: WebSocket, msg: ClientMessage) {
  switch (msg.type) {
    case "join": {
      const doc = getOrCreateDocument(msg.documentId);
      clientDocs.set(ws, { documentId: msg.documentId, siteId: msg.siteId });

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
      broadcastToDocument(msg.documentId, ws, {
        type: "joined",
        documentId: msg.documentId,
        siteId: msg.siteId,
        name: msg.name,
      });
      break;
    }

    case "operation": {
      if (!msg.operation || msg.version === undefined) return;
      const doc = documents.get(msg.documentId);
      if (!doc) return;

      const transformed = doc.applyOperation(msg.operation, msg.version);

      broadcastToDocument(msg.documentId, ws, {
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
      const doc = documents.get(msg.documentId);
      if (!doc) return;

      doc.setPeer({
        siteId: msg.siteId,
        name: msg.name ?? msg.siteId,
        cursorPosition: msg.cursor.position,
        selectionStart: msg.cursor.selectionStart,
        selectionEnd: msg.cursor.selectionEnd,
        lastSeen: Date.now(),
      });

      broadcastToDocument(msg.documentId, ws, {
        type: "cursor",
        documentId: msg.documentId,
        siteId: msg.siteId,
        cursor: msg.cursor,
      });
      break;
    }

    case "leave": {
      const doc = documents.get(msg.documentId);
      if (doc) {
        doc.removePeer(msg.siteId);
      }
      clientDocs.delete(ws);
      broadcastToDocument(msg.documentId, ws, {
        type: "peer_left",
        documentId: msg.documentId,
        siteId: msg.siteId,
      });
      break;
    }
  }
}

function broadcastToDocument(
  documentId: string,
  exclude: WebSocket,
  message: ServerMessage,
) {
  const json = JSON.stringify(message);
  for (const [client, info] of clientDocs) {
    if (info.documentId === documentId && client !== exclude) {
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
