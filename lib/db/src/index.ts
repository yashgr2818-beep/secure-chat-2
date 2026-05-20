import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const url = process.env.DATABASE_URL || "";
let sslConfig: any = { rejectUnauthorized: false };
if (url.includes("localhost") || url.includes("127.0.0.1") || url.includes(".internal") || url.includes("sslmode=disable")) {
  sslConfig = false;
}

export const pool = new Pool({
  connectionString: url,
  ssl: sslConfig,
});
export const db = drizzle(pool, { schema });

export * from "./schema";
