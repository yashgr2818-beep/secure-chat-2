import { Router, type IRouter } from "express";
import { db, usersTable, messagesTable } from "@workspace/db";
import { ne, eq, and, or, desc } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { manager } from "../websocket";

const router: IRouter = Router();

router.get("/users", requireAuth, async (req: AuthRequest, res) => {
  try {
    const me = req.user!;
    const users = await db.select().from(usersTable).where(ne(usersTable.username, me.username));
    
    const usersWithLastMsg = await Promise.all(users.map(async u => {
      const [lastMsg] = await db.select({
        timestamp: messagesTable.timestamp
      })
      .from(messagesTable)
      .where(
        or(
          and(eq(messagesTable.fromUsername, me.username), eq(messagesTable.toUsername, u.username)),
          and(eq(messagesTable.fromUsername, u.username), eq(messagesTable.toUsername, me.username))
        )
      )
      .orderBy(desc(messagesTable.timestamp))
      .limit(1);

      return {
        id: u.id,
        username: u.username,
        online: manager.isOnline(u.username),
        lastSeen: u.lastSeen?.toISOString() || null,
        lastMessageAt: lastMsg ? lastMsg.timestamp.toISOString() : null
      };
    }));

    return res.json(usersWithLastMsg);
  } catch (err) {
    return res.status(500).json({ detail: "Internal Server Error" });
  }
});

router.get("/users/:username/public-key", requireAuth, async (req: AuthRequest, res) => {
  try {
    const username = req.params.username as string;
    const [user] = await db.select().from(usersTable).where(eq(usersTable.username, username));
    
    if (!user) {
      return res.status(404).json({ detail: "User not found" });
    }
    
    return res.json({
      username: user.username,
      publicKey: user.publicKey
    });
  } catch (err) {
    return res.status(500).json({ detail: "Internal Server Error" });
  }
});

export default router;
