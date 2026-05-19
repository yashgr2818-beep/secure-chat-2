import { pgTable, serial, text, timestamp, boolean, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  username: varchar("username", { length: 32 }).notNull().unique(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  publicKey: text("public_key").notNull(),
  lastSeen: timestamp("last_seen"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const messagesTable = pgTable("messages", {
  id: serial("id").primaryKey(),
  fromUsername: varchar("from_username", { length: 32 }).notNull(),
  toUsername: varchar("to_username", { length: 32 }).notNull(),
  encryptedContent: text("encrypted_content").notNull(),
  encryptedKey: text("encrypted_key"),
  iv: text("iv"),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  delivered: boolean("delivered").default(false).notNull(),
  read: boolean("read").default(false).notNull(),
});

export const insertUserSchema = createInsertSchema(usersTable);
export const insertMessageSchema = createInsertSchema(messagesTable);

export type User = typeof usersTable.$inferSelect;
export type Message = typeof messagesTable.$inferSelect;