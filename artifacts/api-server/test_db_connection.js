import { db, usersTable } from "@workspace/db";

async function main() {
  console.log("Testing DB connection via @workspace/db...");
  try {
    const users = await db.select().from(usersTable).limit(1);
    console.log("Successfully connected and queried users!");
    console.log(`Found ${users.length} users.`);
  } catch (err) {
    console.error("DB CONNECTION ERROR:", err);
  } finally {
    process.exit(0);
  }
}
main();
