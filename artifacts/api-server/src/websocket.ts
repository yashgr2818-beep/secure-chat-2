import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import jwt from "jsonwebtoken";
import { db, usersTable, messagesTable, groupMembersTable, groupMessageKeysTable } from "@workspace/db";
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

        // Notify original senders that their offline messages are now delivered
        for (const msg of offlineMsgs) {
          manager.sendTo(msg.fromUsername, {
            type: "message_delivered",
            payload: { id: msg.id, toUsername: msg.toUsername }
          });
        }
      }

      // Broadcast online status
      manager.broadcast({ type: "user_online", username }, username);

      ws.on("message", async (data) => {
        try {
          const parsed = JSON.parse(data.toString());

          if (parsed.type === "message") {
            const p = parsed.payload;
            if (p.groupId) {
              const groupId = Number(p.groupId);
              if (Number.isNaN(groupId) || !p.encryptedContent || !p.keys) return;

              // 1. Verify membership
              const [membership] = await db.select()
                .from(groupMembersTable)
                .where(and(eq(groupMembersTable.groupId, groupId), eq(groupMembersTable.username, username)));

              if (!membership) return;

              // 2. Insert group message
              const [newMsg] = await db.insert(messagesTable).values({
                fromUsername: username,
                groupId: groupId,
                encryptedContent: p.encryptedContent,
                iv: p.iv,
                delivered: true, // Group messages are instantly considered delivered to group stream
                read: false,
              }).returning();

              // 3. Insert individual keys for each member
              const keyValues = Object.entries(p.keys).map(([memberUsername, encKey]) => ({
                messageId: newMsg.id,
                username: memberUsername,
                encryptedKey: encKey as string,
              }));

              if (keyValues.length > 0) {
                await db.insert(groupMessageKeysTable).values(keyValues);
              }

              // 4. Fetch all group members
              const members = await db.select().from(groupMembersTable).where(eq(groupMembersTable.groupId, groupId));

              // 5. Broadcast to each online group member
              for (const member of members) {
                // Return their specific E2EE encrypted AES key!
                const memberEncryptedKey = p.keys[member.username] || null;
                const serialized = {
                  ...serializeMessage(newMsg),
                  encryptedKey: memberEncryptedKey,
                };

                if (member.username === username) {
                  // Echo message_sent back to sender
                  manager.sendTo(username, { type: "message_sent", payload: serialized });
                } else {
                  // Send to other group members
                  manager.sendTo(member.username, { type: "message", payload: serialized });
                }
              }
              return;
            }

            // Fallback to 1-to-1 private message
            if (!p.toUsername || !p.encryptedContent) return;

            const [newMsg] = await db.insert(messagesTable).values({
              fromUsername: username,
              toUsername: p.toUsername,
              encryptedContent: p.encryptedContent,
              encryptedKey: p.encryptedKey,
              iv: p.iv,
              delivered: false,
              read: false,
            }).returning();

            const serialized = serializeMessage(newMsg);

            // Send to recipient
            const delivered = manager.sendTo(p.toUsername, { type: "message", payload: serialized });
            // Echo back to sender
            manager.sendTo(username, { type: "message_sent", payload: serialized });

            if (delivered) {
              // Mark delivered in DB
              await db.update(messagesTable)
                .set({ delivered: true })
                .where(eq(messagesTable.id, newMsg.id));

              // Notify sender: message was delivered (double grey tick)
              manager.sendTo(username, {
                type: "message_delivered",
                payload: { id: newMsg.id, toUsername: p.toUsername }
              });
            }
          } else if (parsed.type === "read_receipt") {
            // Client tells server they have read all messages from a specific sender
            const { fromUsername: sender } = parsed.payload;
            if (!sender) return;

            // Find all unread messages from sender to this user
            const unread = await db
              .select()
              .from(messagesTable)
              .where(
                and(
                  eq(messagesTable.fromUsername, sender),
                  eq(messagesTable.toUsername, username),
                  eq(messagesTable.read, false)
                )
              );

            if (unread.length > 0) {
              await db.update(messagesTable)
                .set({ read: true, delivered: true })
                .where(inArray(messagesTable.id, unread.map((m: any) => m.id)));

              // Notify original sender: their messages were read (double blue tick)
              manager.sendTo(sender, {
                type: "message_read",
                payload: {
                  ids: unread.map((m: any) => m.id),
                  byUsername: username
                }
              });
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
    toUsername: m.toUsername || null,
    groupId: m.groupId || null,
    encryptedContent: m.encryptedContent,
    encryptedKey: m.encryptedKey || null,
    iv: m.iv,
    timestamp: m.timestamp instanceof Date ? m.timestamp.toISOString() : new Date(m.timestamp).toISOString(),
    delivered: m.delivered,
    read: m.read ?? false,
  };
}
