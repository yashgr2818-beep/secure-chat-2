import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import jwt from "jsonwebtoken";
import { db, usersTable, messagesTable } from "@workspace/db";
import { eq, inArray, and } from "drizzle-orm";
import { logger } from "./lib/logger";

const JWT_SECRET = process.env.SESSION_SECRET || "supersecret-change-me";

export class ConnectionManager {
  private active = new Map<string, WebSocket>();

  connect(username: string, ws: WebSocket) {
    this.active.set(username, ws);
  }

  disconnect(username: string) {
    this.active.delete(username);
  }

  isOnline(username: string): boolean {
    return this.active.has(username);
  }

  sendTo(username: string, payload: any): boolean {
    const ws = this.active.get(username);
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(payload));
        return true;
      } catch (e) {
        this.disconnect(username);
      }
    }
    return false;
  }

  broadcast(payload: any, excludeUsername?: string) {
    for (const [username, ws] of this.active.entries()) {
      if (username !== excludeUsername && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
      }
    }
  }
}

export const manager = new ConnectionManager();

export function setupWebSocket(server: Server) {
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", async (ws, req) => {
    try {
      const url = new URL(req.url || "", `http://${req.headers.host}`);
      const token = url.searchParams.get("token");

      if (!token) {
        ws.close(4001, "Unauthorized");
        return;
      }

      const payload = jwt.verify(token, JWT_SECRET) as any;
      const username = payload.sub;

      if (!username) {
        ws.close(4001, "Unauthorized");
        return;
      }

      manager.connect(username, ws);

      // Deliver offline messages
      const offlineMsgs = await db
        .select()
        .from(messagesTable)
        .where(
          and(
            eq(messagesTable.toUsername, username),
            eq(messagesTable.delivered, false)
          )
        );

      for (const msg of offlineMsgs) {
        manager.sendTo(username, { type: "message", payload: serializeMessage(msg) });
      }

      if (offlineMsgs.length > 0) {
        await db.update(messagesTable)
          .set({ delivered: true })
          .where(inArray(messagesTable.id, offlineMsgs.map((m: any) => m.id)));
      }

      // Broadcast online status
      manager.broadcast({ type: "user_online", username }, username);

      ws.on("message", async (data) => {
        try {
          const parsed = JSON.parse(data.toString());

          if (parsed.type === "message") {
            const p = parsed.payload;
            if (!p.toUsername || !p.encryptedContent) return;

            const [newMsg] = await db.insert(messagesTable).values({
              fromUsername: username,
              toUsername: p.toUsername,
              encryptedContent: p.encryptedContent,
              encryptedKey: p.encryptedKey,
              iv: p.iv,
              delivered: false,
            }).returning();

            const serialized = serializeMessage(newMsg);

            const delivered = manager.sendTo(p.toUsername, { type: "message", payload: serialized });
            manager.sendTo(username, { type: "message_sent", payload: serialized });

            if (delivered) {
              await db.update(messagesTable).set({ delivered: true }).where(eq(messagesTable.id, newMsg.id));
            }
          } else if (parsed.type === "ping") {
            manager.sendTo(username, { type: "pong" });
          }
        } catch (e) {
          logger.error({ err: e }, "Error handling WS message");
        }
      });

      ws.on("close", async () => {
        manager.disconnect(username);
        await db.update(usersTable).set({ lastSeen: new Date() }).where(eq(usersTable.username, username));
        manager.broadcast({ type: "user_offline", username });
      });

    } catch (e) {
      ws.close(4001, "Unauthorized");
    }
  });
}

function serializeMessage(m: any) {
  return {
    id: m.id,
    fromUsername: m.fromUsername,
    toUsername: m.toUsername,
    encryptedContent: m.encryptedContent,
    encryptedKey: m.encryptedKey,
    iv: m.iv,
    timestamp: m.timestamp.toISOString(),
    delivered: m.delivered,
  };
}
