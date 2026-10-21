CREATE TYPE "public"."lead_state" AS ENUM('NEW', 'QUALIFIED', 'PLANNING', 'QUOTED', 'CONVERTED', 'LOST');--> statement-breakpoint
ALTER TYPE "public"."acceptance_channel" ADD VALUE 'WEB';--> statement-breakpoint
CREATE SEQUENCE "public"."lead_reference_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1001 CACHE 1;--> statement-breakpoint
CREATE TABLE "lead" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text DEFAULT 'REQ-' || lpad(nextval('lead_reference_seq')::text, 6, '0') NOT NULL,
	"state" "lead_state" NOT NULL,
	"customer_user_id" uuid NOT NULL,
	"source_channel" "source_channel" NOT NULL,
	"request" jsonb NOT NULL,
	"start_date" date NOT NULL,
	"lost_reason" text,
	"accepted_proposal_id" uuid,
	"booking_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_proposal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"version" smallint NOT NULL,
	"plan" jsonb NOT NULL,
	"subtotal_paise" integer NOT NULL,
	"tax_paise" integer NOT NULL,
	"total_paise" integer NOT NULL,
	"valid_until" timestamp with time zone NOT NULL,
	"validation" jsonb NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_proposal_total_chk" CHECK ("lead_proposal"."total_paise" = "lead_proposal"."subtotal_paise" + "lead_proposal"."tax_paise")
);
--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_customer_user_id_app_user_id_fk" FOREIGN KEY ("customer_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_booking_id_booking_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."booking"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_proposal" ADD CONSTRAINT "lead_proposal_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_proposal" ADD CONSTRAINT "lead_proposal_created_by_user_id_app_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lead_reference_uq" ON "lead" USING btree ("reference");--> statement-breakpoint
CREATE INDEX "lead_customer_idx" ON "lead" USING btree ("customer_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lead_proposal_version_uq" ON "lead_proposal" USING btree ("lead_id","version");