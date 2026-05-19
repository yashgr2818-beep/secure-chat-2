import pg from "pg";

const { Client } = pg;

const connectionString = "postgresql://neondb_owner:npg_Eb74RnfGkshN@ep-super-sun-aprktdn4-pooler.c-7.us-east-1.aws.neon.tech/neondb?sslmode=require";

async function run() {
  const client = new Client({ connectionString });
  await client.connect();

  console.log("Connected to Neon DB. Running schema updates...");

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS "groups" (
        "id" serial PRIMARY KEY NOT NULL,
        "name" varchar(64) NOT NULL,
        "created_by" varchar(32) NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL
      );
    `);
    console.log("groups created");

    await client.query(`
      CREATE TABLE IF NOT EXISTS "group_members" (
        "id" serial PRIMARY KEY NOT NULL,
        "group_id" integer NOT NULL,
        "username" varchar(32) NOT NULL,
        "joined_at" timestamp DEFAULT now() NOT NULL,
        CONSTRAINT "group_members_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE cascade
      );
    `);
    console.log("group_members created");

    await client.query(`
      ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "group_id" integer;
    `);
    console.log("messages group_id added");

    try {
      await client.query(`
        ALTER TABLE "messages" ADD CONSTRAINT "messages_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE cascade;
      `);
    } catch (e) {
      // constraint might already exist
    }

    try {
      await client.query(`
        ALTER TABLE "messages" ALTER COLUMN "to_username" DROP NOT NULL;
      `);
    } catch (e) {
      // column might already not be null
    }
    
    await client.query(`
      CREATE TABLE IF NOT EXISTS "group_message_keys" (
        "id" serial PRIMARY KEY NOT NULL,
        "message_id" integer NOT NULL,
        "username" varchar(32) NOT NULL,
        "encrypted_key" text NOT NULL,
        CONSTRAINT "group_message_keys_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE cascade
      );
    `);
    console.log("group_message_keys created");

    console.log("SUCCESS!");
  } catch (err) {
    console.error("Error running schema updates:", err);
  } finally {
    await client.end();
  }
}

run();
