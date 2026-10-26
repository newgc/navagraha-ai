CREATE TYPE "public"."fact_check_status" AS ENUM('OPEN', 'ACCEPTED', 'REJECTED', 'SUPERSEDED');--> statement-breakpoint
CREATE TYPE "public"."fact_subject" AS ENUM('TEMPLE', 'SCHEDULE', 'SPECIAL_DAY', 'SERVICE', 'TRAVEL_TIME');--> statement-breakpoint
ALTER TYPE "public"."source_type" ADD VALUE 'OPERATIONS_OBSERVATION';--> statement-breakpoint
ALTER TYPE "public"."source_type" ADD VALUE 'CUSTOMER_REPORT';--> statement-breakpoint
CREATE TABLE "fact_check" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject" "fact_subject" NOT NULL,
	"subject_key" text NOT NULL,
	"temple_code" text,
	"field" text NOT NULL,
	"value" text NOT NULL,
	"source" text NOT NULL,
	"source_type" "source_type" NOT NULL,
	"source_url" text,
	"observed_on" date NOT NULL,
	"note" text,
	"status" "fact_check_status" DEFAULT 'OPEN' NOT NULL,
	"recorded_by_user_id" uuid NOT NULL,
	"decided_by_user_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fact_check" ADD CONSTRAINT "fact_check_recorded_by_user_id_app_user_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_check" ADD CONSTRAINT "fact_check_decided_by_user_id_app_user_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fact_check_subject_idx" ON "fact_check" USING btree ("subject_key","field");--> statement-breakpoint
CREATE INDEX "fact_check_status_idx" ON "fact_check" USING btree ("status");