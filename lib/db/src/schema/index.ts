import { pgTable, serial, text, timestamp, boolean, varchar, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  username: varchar("username", { length: 32 }).notNull().unique(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  publicKey: text("public_key").notNull(),
  lastSeen: timestamp("last_seen"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const groupsTable = pgTable("groups", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 64 }).notNull(),
  createdBy: varchar("created_by", { length: 32 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const groupMembersTable = pgTable("group_members", {
  id: serial("id").primaryKey(),
  groupId: integer("group_id").references(() => groupsTable.id, { onDelete: "cascade" }).notNull(),
  username: varchar("username", { length: 32 }).notNull(),
  joinedAt: timestamp("joined_at").defaultNow().notNull(),
});

export const messagesTable = pgTable("messages", {
  id: serial("id").primaryKey(),
  fromUsername: varchar("from_username", { length: 32 }).notNull(),
  toUsername: varchar("to_username", { length: 32 }),
  groupId: integer("group_id").references(() => groupsTable.id, { onDelete: "cascade" }),
  encryptedContent: text("encrypted_content").notNull(),
  encryptedKey: text("encrypted_key"),
  iv: text("iv"),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  delivered: boolean("delivered").default(false).notNull(),
  read: boolean("read").default(false).notNull(),
});

export const groupMessageKeysTable = pgTable("group_message_keys", {
  id: serial("id").primaryKey(),
  messageId: integer("message_id").references(() => messagesTable.id, { onDelete: "cascade" }).notNull(),
  username: varchar("username", { length: 32 }).notNull(),
  encryptedKey: text("encrypted_key").notNull(),
});

export const insertUserSchema = createInsertSchema(usersTable);
export const insertMessageSchema = createInsertSchema(messagesTable);
export const insertGroupSchema = createInsertSchema(groupsTable);
export const insertGroupMemberSchema = createInsertSchema(groupMembersTable);

export type User = typeof usersTable.$inferSelect;
export type Message = typeof messagesTable.$inferSelect;
export type Group = typeof groupsTable.$inferSelect;
export type GroupMember = typeof groupMembersTable.$inferSelect;