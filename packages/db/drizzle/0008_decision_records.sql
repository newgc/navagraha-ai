CREATE TABLE "decision_record" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"lead_id" uuid,
	"input" jsonb NOT NULL,
	"status" text NOT NULL,
	"result" jsonb NOT NULL,
	"recommended" text,
	"config_version" text NOT NULL,
	"facts_version" text NOT NULL,
	"correlation_id" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "decision_record" ADD CONSTRAINT "decision_record_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_record" ADD CONSTRAINT "decision_record_created_by_user_id_app_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "decision_record_lead_idx" ON "decision_record" USING btree ("lead_id");