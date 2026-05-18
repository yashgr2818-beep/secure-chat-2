import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const JWT_SECRET = process.env.SESSION_SECRET || "supersecret-change-me";

export interface AuthRequest extends Request {
  user?: {
    id: number;
    username: string;
  };
}

export const requireAuth = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ detail: "Missing token" });
  }

  const token = authHeader.split(" ")[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET) as any;
    const username = payload.sub;

    if (!username) {
      return res.status(401).json({ detail: "Invalid token" });
    }

    const [user] = await db.select().from(usersTable).where(eq(usersTable.username, username));
    if (!user) {
      return res.status(401).json({ detail: "User not found" });
    }

    req.user = { id: user.id, username: user.username };
    next();
    return;
  } catch (err) {
    return res.status(401).json({ detail: "Invalid token" });
  }
};
