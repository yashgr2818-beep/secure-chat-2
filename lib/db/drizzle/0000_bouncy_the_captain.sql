CREATE TABLE "group_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"group_id" integer NOT NULL,
	"username" varchar(32) NOT NULL,
	"joined_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "group_message_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"message_id" integer NOT NULL,
	"username" varchar(32) NOT NULL,
	"encrypted_key" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"created_by" varchar(32) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"from_username" varchar(32) NOT NULL,
	"to_username" varchar(32),
	"group_id" integer,
	"encrypted_content" text NOT NULL,
	"encrypted_key" text,
	"iv" text,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"delivered" boolean DEFAULT false NOT NULL,
	"read" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" varchar(32) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"public_key" text NOT NULL,
	"last_seen" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_message_keys" ADD CONSTRAINT "group_message_keys_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;