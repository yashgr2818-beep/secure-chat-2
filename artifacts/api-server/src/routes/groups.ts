import { Router, type IRouter } from "express";
import { db, groupsTable, groupMembersTable, messagesTable, groupMessageKeysTable, messageReactionsTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../middlewares/auth";

const router: IRouter = Router();

// Create a Group: POST /groups
router.post("/groups", requireAuth, async (req: AuthRequest, res) => {
  try {
    const me = req.user!;
    const { name, members } = req.body;

    if (!name || !members || !Array.isArray(members) || members.length === 0) {
      return res.status(400).json({ detail: "Name and members array are required" });
    }

    // Insert Group
    const [group] = await db.insert(groupsTable).values({
      name,
      createdBy: me.username,
    }).returning();

    // Insert group members (ensure creator is included!)
    const uniqueMembers = Array.from(new Set([...members, me.username]));
    const memberValues = uniqueMembers.map(username => ({
      groupId: group.id,
      username,
    }));

    await db.insert(groupMembersTable).values(memberValues);

    return res.status(201).json({
      id: group.id,
      name: group.name,
      createdBy: group.createdBy,
      createdAt: group.createdAt.toISOString(),
      members: uniqueMembers,
    });
  } catch (err) {
    console.error("GROUPS POST ERROR:", err);
    return res.status(500).json({ detail: "Internal Server Error", error: err instanceof Error ? err.message : String(err) });
  }
});

// List Groups: GET /groups
router.get("/groups", requireAuth, async (req: AuthRequest, res) => {
  try {
    const me = req.user!;

    // 1. Get all group IDs where me.username is a member
    const memberships = await db.select().from(groupMembersTable).where(eq(groupMembersTable.username, me.username));
    if (memberships.length === 0) {
      return res.json([]);
    }

    const groupIds = memberships.map(m => m.groupId);

    // 2. Fetch all of these groups
    const groups = await db.select().from(groupsTable).where(inArray(groupsTable.id, groupIds));

    // 3. For each group, fetch all members
    const allMembers = await db.select().from(groupMembersTable).where(inArray(groupMembersTable.groupId, groupIds));

    const result = groups.map(g => {
      const members = allMembers.filter(m => m.groupId === g.id).map(m => m.username);
      return {
        id: g.id,
        name: g.name,
        createdBy: g.createdBy,
        createdAt: g.createdAt.toISOString(),
        members,
      };
    });

    return res.json(result);
  } catch (err) {
    console.error("GROUPS GET LIST ERROR:", err);
    return res.status(500).json({ detail: "Internal Server Error", error: err instanceof Error ? err.message : String(err) });
  }
});

// Get Group Messages: GET /groups/:id/messages
router.get("/groups/:id/messages", requireAuth, async (req: AuthRequest, res) => {
  try {
    const me = req.user!;
    const groupId = Number(req.params.id);

    if (Number.isNaN(groupId)) {
      return res.status(400).json({ detail: "Invalid Group ID" });
    }

    // Verify membership
    const [membership] = await db.select()
      .from(groupMembersTable)
      .where(and(eq(groupMembersTable.groupId, groupId), eq(groupMembersTable.username, me.username)));

    if (!membership) {
      return res.status(403).json({ detail: "Forbidden: You are not a member of this group" });
    }

    // Fetch messages for the group, joining groupMessageKeysTable for the current user
    const rawMsgs = await db.select({
      id: messagesTable.id,
      fromUsername: messagesTable.fromUsername,
      encryptedContent: messagesTable.encryptedContent,
      iv: messagesTable.iv,
      timestamp: messagesTable.timestamp,
      delivered: messagesTable.delivered,
      read: messagesTable.read,
      encryptedKey: groupMessageKeysTable.encryptedKey,
    })
    .from(messagesTable)
    .leftJoin(
      groupMessageKeysTable,
      and(
        eq(groupMessageKeysTable.messageId, messagesTable.id),
        eq(groupMessageKeysTable.username, me.username)
      )
    )
    .where(eq(messagesTable.groupId, groupId))
    .orderBy(messagesTable.timestamp);

    if (rawMsgs.length === 0) return res.json([]);

    const msgIds = rawMsgs.map(m => m.id);
    const reactions = await db.select().from(messageReactionsTable).where(inArray(messageReactionsTable.messageId, msgIds));

    return res.json(rawMsgs.map(m => {
      const msgReactions = reactions.filter(r => r.messageId === m.id).map(r => ({
        username: r.username,
        emoji: r.emoji
      }));
      return {
        id: m.id,
        fromUsername: m.fromUsername,
        groupId,
        encryptedContent: m.encryptedContent,
        encryptedKey: m.encryptedKey || null,
        iv: m.iv,
        timestamp: m.timestamp ? (m.timestamp instanceof Date ? m.timestamp.toISOString() : new Date(m.timestamp).toISOString()) : new Date().toISOString(),
        delivered: m.delivered,
        read: m.read,
        reactions: msgReactions,
      };
    }));

  } catch (err) {
    console.error("GROUPS GET MESSAGES ERROR:", err);
    return res.status(500).json({ detail: "Internal Server Error", error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
