CREATE TABLE "history" (
	"id" serial PRIMARY KEY,
	"user_id" uuid NOT NULL,
	"emotion" text NOT NULL,
	"confidence" double precision NOT NULL,
	"probabilities" jsonb NOT NULL,
	"image_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" text NOT NULL,
	"age" integer NOT NULL,
	"gender" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "history_user_idx" ON "history" ("user_id","id");--> statement-breakpoint
ALTER TABLE "history" ADD CONSTRAINT "history_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;