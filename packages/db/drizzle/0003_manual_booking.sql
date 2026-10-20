CREATE TYPE "public"."acceptance_channel" AS ENUM('PHONE', 'WHATSAPP', 'IN_PERSON', 'EMAIL');--> statement-breakpoint
CREATE TYPE "public"."booking_state" AS ENUM('REQUESTED', 'PENDING_CONFIRMATION', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."fulfilment_component_state" AS ENUM('PENDING', 'REQUESTED', 'CONFIRMED', 'DECLINED', 'RELEASED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."fulfilment_kind" AS ENUM('VEHICLE', 'HOTEL', 'POOJA', 'PICKUP', 'GUIDE', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."itinerary_state" AS ENUM('DRAFT', 'VALIDATED', 'PROPOSED', 'ACCEPTED', 'OPS_ADJUSTED', 'LIVE', 'COMPLETED', 'ABANDONED', 'SUPERSEDED');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('GATEWAY', 'OFFLINE_UPI', 'OFFLINE_BANK_TRANSFER', 'CASH', 'WAIVER');--> statement-breakpoint
CREATE TYPE "public"."payment_state" AS ENUM('NOT_REQUIRED', 'PENDING', 'SUCCESS', 'FAILED', 'PARTIALLY_REFUNDED', 'REFUNDED');--> statement-breakpoint
CREATE TYPE "public"."planning_mode" AS ENUM('FAST', 'BALANCED', 'RELAXED');--> statement-breakpoint
CREATE TYPE "public"."quote_line_kind" AS ENUM('VEHICLE', 'HOTEL', 'POOJA', 'PICKUP', 'GUIDE', 'SERVICE_FEE', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."quote_state" AS ENUM('DRAFT', 'CALCULATED', 'PRESENTED', 'LOCKED', 'EXPIRED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."source_channel" AS ENUM('PHONE', 'WHATSAPP', 'WALK_IN', 'REFERRAL', 'WEB', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."template_code" AS ENUM('1D', '2D1N');--> statement-breakpoint
CREATE TYPE "public"."trip_state" AS ENUM('SCHEDULED', 'DRIVER_ASSIGNED', 'PICKUP_READY', 'STARTED', 'IN_PROGRESS', 'INCIDENT', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE SEQUENCE "public"."booking_reference_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1001 CACHE 1;--> statement-breakpoint
CREATE TABLE "booking" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text DEFAULT 'NAV-' || lpad(nextval('booking_reference_seq')::text, 6, '0') NOT NULL,
	"state" "booking_state" NOT NULL,
	"booker_user_id" uuid NOT NULL,
	"circuit_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"template" "template_code" NOT NULL,
	"mode" "planning_mode" NOT NULL,
	"senior_friendly" boolean DEFAULT false NOT NULL,
	"tier" text,
	"pickup_location" text,
	"pickup_time" time,
	"source_channel" "source_channel" NOT NULL,
	"source_reference" text,
	"payment_policy" jsonb DEFAULT '{"kind":"FULL_PAYMENT"}'::jsonb NOT NULL,
	"active_itinerary_id" uuid,
	"active_quote_id" uuid,
	"notes" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking_traveller" (
	"booking_id" uuid NOT NULL,
	"traveller_id" uuid NOT NULL,
	"is_lead" boolean DEFAULT false NOT NULL,
	CONSTRAINT "booking_traveller_booking_id_traveller_id_pk" PRIMARY KEY("booking_id","traveller_id")
);
--> statement-breakpoint
CREATE TABLE "fulfilment_component" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"slot" text NOT NULL,
	"kind" "fulfilment_kind" NOT NULL,
	"mandatory" boolean NOT NULL,
	"state" "fulfilment_component_state" NOT NULL,
	"description" text,
	"supplier_name" text,
	"supplier_reference" text,
	"capacity" smallint,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "itinerary" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"version" smallint NOT NULL,
	"parent_id" uuid,
	"state" "itinerary_state" NOT NULL,
	"origin" text NOT NULL,
	"validation" jsonb,
	"reason" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "itinerary_stop" (
	"itinerary_id" uuid NOT NULL,
	"seq" smallint NOT NULL,
	"day" smallint NOT NULL,
	"temple_id" uuid NOT NULL,
	"planned_arrival" time,
	"notes" text,
	CONSTRAINT "itinerary_stop_itinerary_id_seq_pk" PRIMARY KEY("itinerary_id","seq")
);
--> statement-breakpoint
CREATE TABLE "payment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"state" "payment_state" NOT NULL,
	"method" "payment_method" NOT NULL,
	"amount_paise" integer NOT NULL,
	"captured_paise" integer DEFAULT 0 NOT NULL,
	"refunded_paise" integer DEFAULT 0 NOT NULL,
	"reference" text,
	"received_on" date,
	"recorded_by_user_id" uuid,
	"recorded_at" timestamp with time zone,
	"confirmed_by_user_id" uuid,
	"confirmed_at" timestamp with time zone,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_amounts_chk" CHECK ("payment"."amount_paise" >= 0 and "payment"."refunded_paise" <= "payment"."captured_paise"),
	CONSTRAINT "payment_two_person_chk" CHECK ("payment"."confirmed_by_user_id" is null or "payment"."recorded_by_user_id" is null or "payment"."confirmed_by_user_id" <> "payment"."recorded_by_user_id")
);
--> statement-breakpoint
CREATE TABLE "quote" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"version" smallint NOT NULL,
	"state" "quote_state" NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"subtotal_paise" integer NOT NULL,
	"tax_paise" integer NOT NULL,
	"total_paise" integer NOT NULL,
	"pricing_source" text NOT NULL,
	"rate_card_version" text,
	"valid_until" timestamp with time zone NOT NULL,
	"locked_at" timestamp with time zone,
	"accepted_via" "acceptance_channel",
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quote_total_chk" CHECK ("quote"."total_paise" = "quote"."subtotal_paise" + "quote"."tax_paise")
);
--> statement-breakpoint
CREATE TABLE "quote_line" (
	"quote_id" uuid NOT NULL,
	"seq" smallint NOT NULL,
	"kind" "quote_line_kind" NOT NULL,
	"description" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_paise" integer NOT NULL,
	"tax_paise" integer NOT NULL,
	"line_total_paise" integer NOT NULL,
	CONSTRAINT "quote_line_quote_id_seq_pk" PRIMARY KEY("quote_id","seq"),
	CONSTRAINT "quote_line_total_chk" CHECK ("quote_line"."line_total_paise" = "quote_line"."quantity" * "quote_line"."unit_price_paise" + "quote_line"."tax_paise")
);
--> statement-breakpoint
CREATE TABLE "trip" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"state" "trip_state" NOT NULL,
	"start_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "booking" ADD CONSTRAINT "booking_booker_user_id_app_user_id_fk" FOREIGN KEY ("booker_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking" ADD CONSTRAINT "booking_circuit_id_circuit_id_fk" FOREIGN KEY ("circuit_id") REFERENCES "public"."circuit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking" ADD CONSTRAINT "booking_active_itinerary_id_itinerary_id_fk" FOREIGN KEY ("active_itinerary_id") REFERENCES "public"."itinerary"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking" ADD CONSTRAINT "booking_active_quote_id_quote_id_fk" FOREIGN KEY ("active_quote_id") REFERENCES "public"."quote"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking" ADD CONSTRAINT "booking_created_by_user_id_app_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_traveller" ADD CONSTRAINT "booking_traveller_booking_id_booking_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."booking"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_traveller" ADD CONSTRAINT "booking_traveller_traveller_id_traveller_id_fk" FOREIGN KEY ("traveller_id") REFERENCES "public"."traveller"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fulfilment_component" ADD CONSTRAINT "fulfilment_component_booking_id_booking_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."booking"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itinerary" ADD CONSTRAINT "itinerary_booking_id_booking_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."booking"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itinerary" ADD CONSTRAINT "itinerary_parent_id_itinerary_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."itinerary"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itinerary" ADD CONSTRAINT "itinerary_created_by_user_id_app_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itinerary_stop" ADD CONSTRAINT "itinerary_stop_itinerary_id_itinerary_id_fk" FOREIGN KEY ("itinerary_id") REFERENCES "public"."itinerary"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itinerary_stop" ADD CONSTRAINT "itinerary_stop_temple_id_temple_id_fk" FOREIGN KEY ("temple_id") REFERENCES "public"."temple"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_booking_id_booking_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."booking"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_recorded_by_user_id_app_user_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_confirmed_by_user_id_app_user_id_fk" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_booking_id_booking_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."booking"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_created_by_user_id_app_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_line" ADD CONSTRAINT "quote_line_quote_id_quote_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quote"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip" ADD CONSTRAINT "trip_booking_id_booking_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."booking"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "booking_reference_uq" ON "booking" USING btree ("reference");--> statement-breakpoint
CREATE INDEX "booking_start_date_idx" ON "booking" USING btree ("start_date");--> statement-breakpoint
CREATE INDEX "booking_booker_idx" ON "booking" USING btree ("booker_user_id");--> statement-breakpoint
CREATE INDEX "fulfilment_component_booking_idx" ON "fulfilment_component" USING btree ("booking_id");--> statement-breakpoint
CREATE UNIQUE INDEX "itinerary_version_uq" ON "itinerary" USING btree ("booking_id","version");--> statement-breakpoint
CREATE INDEX "payment_booking_idx" ON "payment" USING btree ("booking_id");--> statement-breakpoint
CREATE UNIQUE INDEX "quote_version_uq" ON "quote" USING btree ("booking_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_booking_uq" ON "trip" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "trip_start_date_idx" ON "trip" USING btree ("start_date");