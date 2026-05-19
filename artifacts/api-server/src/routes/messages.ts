import { Router, type IRouter } from "express";
import { db, messagesTable } from "@workspace/db";
import { eq, and, or, inArray } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../middlewares/auth";

const router: IRouter = Router();

function serializeMessage(m: any) {
  return {
    id: m.id,
    fromUsername: m.fromUsername,
    toUsername: m.toUsername,
    encryptedContent: m.encryptedContent,
    encryptedKey: m.encryptedKey,
    iv: m.iv,
    timestamp: m.timestamp ? (m.timestamp instanceof Date ? m.timestamp.toISOString() : new Date(m.timestamp).toISOString()) : new Date().toISOString(),
    delivered: m.delivered,
    read: m.read,
  };
}

router.get("/messages/unread", requireAuth, async (req: AuthRequest, res) => {
  try {
    const me = req.user!;
    const msgs = await db.select().from(messagesTable)
      .where(and(eq(messagesTable.toUsername, me.username), eq(messagesTable.delivered, false)))
      .orderBy(messagesTable.timestamp);

    if (msgs.length > 0) {
      await db.update(messagesTable)
        .set({ delivered: true })
        .where(inArray(messagesTable.id, msgs.map((m: any) => m.id)));
    }

    return res.json(msgs.map(serializeMessage));
  } catch (err) {
    return res.status(500).json({ detail: "Internal Server Error" });
  }
});

router.get("/messages/:username", requireAuth, async (req: AuthRequest, res) => {
  try {
    const me = req.user!;
    const username = req.params.username as string;

    const msgs = await db.select().from(messagesTable)
      .where(
        or(
          and(eq(messagesTable.fromUsername, me.username), eq(messagesTable.toUsername, username)),
          and(eq(messagesTable.fromUsername, username), eq(messagesTable.toUsername, me.username))
        )
      )
      .orderBy(messagesTable.timestamp);

    return res.json(msgs.map(serializeMessage));
  } catch (err) {
    return res.status(500).json({ detail: "Internal Server Error" });
  }
});

router.get("/admin/messages", requireAuth, async (req: AuthRequest, res) => {
  try {
    const me = req.user!;
    if (me.username !== "admin") {
      return res.status(403).json({ detail: "Forbidden: Admins only" });
    }

    const msgs = await db.select().from(messagesTable).orderBy(messagesTable.timestamp);
    return res.json(msgs.map(serializeMessage));
  } catch (err) {
    return res.status(500).json({ detail: "Internal Server Error" });
  }
});

export default router;
