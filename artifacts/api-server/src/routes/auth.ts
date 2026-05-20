import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { manager } from "../websocket";

const JWT_SECRET = process.env.SESSION_SECRET || "supersecret-change-me";
const router: IRouter = Router();

router.post("/auth/signup", async (req, res) => {
  try {
    const { username, password, publicKey } = req.body;

    const [existing] = await db.select().from(usersTable).where(eq(usersTable.username, username));
    if (existing) {
      return res.status(409).json({ detail: "Username already taken" });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    
    const [user] = await db.insert(usersTable).values({
      username,
      passwordHash,
      publicKey,
    }).returning();

    const token = jwt.sign({ sub: username }, JWT_SECRET, { expiresIn: "7d" });

    return res.status(201).json({
      token,
      user: {
        id: user.id,
        username: user.username,
        online: true,
        lastSeen: user.lastSeen?.toISOString() || null,
        profilePicture: user.profilePicture
      }
    });
  } catch (err) {
    console.error("SIGNUP ERROR:", err);
    return res.status(500).json({ detail: "Internal Server Error" });
  }
});

router.post("/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    
    const [user] = await db.select().from(usersTable).where(eq(usersTable.username, username));
    if (!user) {
      return res.status(401).json({ detail: "Invalid credentials" });
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      return res.status(401).json({ detail: "Invalid credentials" });
    }

    const token = jwt.sign({ sub: username }, JWT_SECRET, { expiresIn: "7d" });

    return res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        online: manager.isOnline(user.username),
        lastSeen: user.lastSeen?.toISOString() || null,
        profilePicture: user.profilePicture
      }
    });
  } catch (err) {
    console.error("LOGIN ERROR:", err);
    return res.status(500).json({ detail: "Internal Server Error" });
  }
});

export default router;
