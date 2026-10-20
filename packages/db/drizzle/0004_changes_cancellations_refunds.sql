CREATE TYPE "public"."cancellation_state" AS ENUM('REQUESTED', 'REVIEWING', 'APPROVED', 'REJECTED', 'REFUND_PENDING', 'REFUNDED', 'CLOSED_NO_REFUND');--> statement-breakpoint
CREATE TYPE "public"."change_kind" AS ENUM('DATE', 'TRAVELLERS', 'ITINERARY', 'PRICE', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."change_request_state" AS ENUM('REQUESTED', 'REVIEWING', 'APPROVED', 'REJECTED', 'APPLIED', 'WITHDRAWN');--> statement-breakpoint
CREATE TYPE "public"."refund_method" AS ENUM('OFFLINE_UPI', 'OFFLINE_BANK_TRANSFER', 'CASH');--> statement-breakpoint
CREATE TYPE "public"."refund_state" AS ENUM('INITIATED', 'CONFIRMED', 'FAILED');--> statement-breakpoint
CREATE TABLE "cancellation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"state" "cancellation_state" NOT NULL,
	"reason" text NOT NULL,
	"requested_via" "source_channel" NOT NULL,
	"requested_by_user_id" uuid,
	"refund_paise" integer,
	"refund_note" text,
	"reviewed_by_user_id" uuid,
	"decided_by_user_id" uuid,
	"decision_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cancellation_refund_chk" CHECK ("cancellation"."refund_paise" is null or "cancellation"."refund_paise" >= 0)
);
--> statement-breakpoint
CREATE TABLE "change_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"state" "change_request_state" NOT NULL,
	"kind" "change_kind" NOT NULL,
	"description" text NOT NULL,
	"requested_via" "source_channel" NOT NULL,
	"requested_by_user_id" uuid,
	"proposed_itinerary_id" uuid,
	"proposed_quote_id" uuid,
	"proposal" jsonb,
	"accepted_via" "acceptance_channel",
	"decided_by_user_id" uuid,
	"decision_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refund" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"cancellation_id" uuid,
	"state" "refund_state" NOT NULL,
	"method" "refund_method" NOT NULL,
	"amount_paise" integer NOT NULL,
	"reference" text NOT NULL,
	"paid_on" date NOT NULL,
	"initiated_by_user_id" uuid,
	"confirmed_by_user_id" uuid,
	"confirmed_at" timestamp with time zone,
	"allocations" jsonb,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refund_amount_chk" CHECK ("refund"."amount_paise" > 0),
	CONSTRAINT "refund_two_person_chk" CHECK ("refund"."confirmed_by_user_id" is null or "refund"."initiated_by_user_id" is null or "refund"."confirmed_by_user_id" <> "refund"."initiated_by_user_id")
);
--> statement-breakpoint
ALTER TABLE "cancellation" ADD CONSTRAINT "cancellation_booking_id_booking_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."booking"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cancellation" ADD CONSTRAINT "cancellation_requested_by_user_id_app_user_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cancellation" ADD CONSTRAINT "cancellation_reviewed_by_user_id_app_user_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cancellation" ADD CONSTRAINT "cancellation_decided_by_user_id_app_user_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_request" ADD CONSTRAINT "change_request_booking_id_booking_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."booking"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_request" ADD CONSTRAINT "change_request_requested_by_user_id_app_user_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_request" ADD CONSTRAINT "change_request_proposed_itinerary_id_itinerary_id_fk" FOREIGN KEY ("proposed_itinerary_id") REFERENCES "public"."itinerary"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_request" ADD CONSTRAINT "change_request_proposed_quote_id_quote_id_fk" FOREIGN KEY ("proposed_quote_id") REFERENCES "public"."quote"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_request" ADD CONSTRAINT "change_request_decided_by_user_id_app_user_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund" ADD CONSTRAINT "refund_booking_id_booking_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."booking"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund" ADD CONSTRAINT "refund_cancellation_id_cancellation_id_fk" FOREIGN KEY ("cancellation_id") REFERENCES "public"."cancellation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund" ADD CONSTRAINT "refund_initiated_by_user_id_app_user_id_fk" FOREIGN KEY ("initiated_by_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund" ADD CONSTRAINT "refund_confirmed_by_user_id_app_user_id_fk" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cancellation_booking_idx" ON "cancellation" USING btree ("booking_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cancellation_one_open_uq" ON "cancellation" USING btree ("booking_id") WHERE state in ('REQUESTED', 'REVIEWING', 'APPROVED', 'REFUND_PENDING');--> statement-breakpoint
CREATE INDEX "change_request_booking_idx" ON "change_request" USING btree ("booking_id");--> statement-breakpoint
CREATE UNIQUE INDEX "change_request_one_open_uq" ON "change_request" USING btree ("booking_id") WHERE state in ('REQUESTED', 'REVIEWING', 'APPROVED');--> statement-breakpoint
CREATE INDEX "refund_booking_idx" ON "refund" USING btree ("booking_id");