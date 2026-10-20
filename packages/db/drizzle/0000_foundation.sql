CREATE TYPE "public"."source_type" AS ENUM('TEMPLE_OFFICE_IN_PERSON', 'TEMPLE_OFFICE_PHONE', 'TEMPLE_OFFICIAL_WEBSITE', 'GOVT_NOTICE', 'TEMPLE_PRIEST', 'PARTNER_DRIVER_GUIDE', 'MAPS_DATED', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('TO_COLLECT', 'COLLECTED', 'VERIFIED', 'NEEDS_RECHECK');--> statement-breakpoint
CREATE TYPE "public"."circuit_status" AS ENUM('DRAFT', 'ACTIVE', 'RETIRED');--> statement-breakpoint
CREATE TYPE "public"."place_kind" AS ENUM('TEMPLE', 'HUB', 'ORIGIN');--> statement-breakpoint
CREATE TYPE "public"."age_band" AS ENUM('CHILD_0_4', 'CHILD_5_11', 'TEEN_12_17', 'ADULT_18_59', 'SENIOR_60_74', 'SENIOR_75_PLUS');--> statement-breakpoint
CREATE TYPE "public"."relationship_to_booker" AS ENUM('SELF', 'PARENT', 'SPOUSE', 'CHILD', 'SIBLING', 'RELATIVE', 'FRIEND', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('CUSTOMER', 'OPS_COORDINATOR', 'OPS_MANAGER', 'DRIVER', 'FINANCE', 'CONTENT_ADMIN', 'SYSTEM_ADMIN');--> statement-breakpoint
CREATE TABLE "circuit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"region" text NOT NULL,
	"status" "circuit_status" DEFAULT 'DRAFT' NOT NULL,
	"active_from" date,
	"active_to" date,
	"source_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "circuit_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "circuit_temple" (
	"circuit_id" uuid NOT NULL,
	"temple_id" uuid NOT NULL,
	"display_order" smallint NOT NULL,
	CONSTRAINT "circuit_temple_circuit_id_temple_id_pk" PRIMARY KEY("circuit_id","temple_id")
);
--> statement-breakpoint
CREATE TABLE "entry_rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"temple_id" uuid,
	"category" text NOT NULL,
	"rule" text NOT NULL,
	"applies_to" text,
	"cost_paise" integer,
	"action" text,
	"source" text,
	"source_type" "source_type",
	"verified_by" text,
	"verified_on" date,
	"verification_status" "verification_status" DEFAULT 'TO_COLLECT' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "place" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" "place_kind" NOT NULL,
	"temple_id" uuid,
	"latitude" double precision,
	"longitude" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "place_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "temple" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"graha" text,
	"common_name" text NOT NULL,
	"official_name" text,
	"main_deity" text,
	"town" text,
	"district" text,
	"state" text,
	"address" text,
	"pin_code" text,
	"latitude" double precision,
	"longitude" double precision,
	"maps_url" text,
	"office_phone" text,
	"website" text,
	"walk_from_parking_metres" integer,
	"steps_to_climb" text,
	"wheelchair_access" boolean,
	"seating_available" boolean,
	"toilets_nearby" boolean,
	"visit_minutes_normal" smallint,
	"visit_minutes_busy" smallint,
	"parking_notes" text,
	"senior_notes" text,
	"source" text,
	"source_type" "source_type",
	"verified_by" text,
	"verified_on" date,
	"verification_status" "verification_status" DEFAULT 'TO_COLLECT' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "temple_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "temple_schedule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"temple_id" uuid NOT NULL,
	"day_type" text NOT NULL,
	"session" text NOT NULL,
	"opens_at" time NOT NULL,
	"closes_at" time NOT NULL,
	"last_entry_at" time,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"source" text,
	"source_type" "source_type",
	"verified_by" text,
	"verified_on" date,
	"verification_status" "verification_status" DEFAULT 'TO_COLLECT' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "temple_service" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"temple_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"traditional_belief" text,
	"available_days" text,
	"time_window" text,
	"duration_minutes" smallint,
	"max_people_per_booking" smallint,
	"book_days_ahead" smallint,
	"booked_via" text,
	"temple_fee_paise" integer,
	"fee_basis" text,
	"items_to_bring" text,
	"items_available" text,
	"dress_requirement" text,
	"active" boolean DEFAULT false NOT NULL,
	"source" text,
	"source_type" "source_type",
	"verified_by" text,
	"verified_on" date,
	"verification_status" "verification_status" DEFAULT 'TO_COLLECT' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "temple_service_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "temple_special_day" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"temple_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"effect" text NOT NULL,
	"changed_opens_at" time,
	"changed_closes_at" time,
	"expected_extra_wait_minutes" smallint,
	"recurs_yearly" boolean,
	"source" text,
	"source_type" "source_type",
	"verified_by" text,
	"verified_on" date,
	"verification_status" "verification_status" DEFAULT 'TO_COLLECT' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "travel_time" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_place_id" uuid NOT NULL,
	"to_place_id" uuid NOT NULL,
	"distance_km" double precision,
	"normal_minutes" smallint,
	"peak_minutes" smallint,
	"peak_hours" text,
	"symmetric" boolean DEFAULT true NOT NULL,
	"road_notes" text,
	"source" text,
	"source_type" "source_type",
	"verified_by" text,
	"verified_on" date,
	"verification_status" "verification_status" DEFAULT 'TO_COLLECT' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone" text,
	"email" text,
	"display_name" text,
	"phone_verified_at" timestamp with time zone,
	"email_verified_at" timestamp with time zone,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_user_contact_chk" CHECK ("app_user"."phone" is not null or "app_user"."email" is not null),
	CONSTRAINT "app_user_phone_e164_chk" CHECK ("app_user"."phone" is null or "app_user"."phone" ~ '^\+[1-9][0-9]{7,14}$')
);
--> statement-breakpoint
CREATE TABLE "app_user_role" (
	"user_id" uuid NOT NULL,
	"role" "user_role" NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"granted_by" uuid,
	CONSTRAINT "app_user_role_user_id_role_pk" PRIMARY KEY("user_id","role")
);
--> statement-breakpoint
CREATE TABLE "traveller" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booker_user_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"age_band" "age_band" NOT NULL,
	"relationship_to_booker" "relationship_to_booker" NOT NULL,
	"phone" text,
	"mobility_notes" text,
	"needs_wheelchair" boolean DEFAULT false NOT NULL,
	"food_preference" text,
	"emergency_contact_name" text,
	"emergency_contact_phone" text,
	"contact_consent_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" uuid,
	"actor_role" text,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"correlation_id" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "state_transition" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "state_transition_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"machine" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"from_state" text,
	"to_state" text NOT NULL,
	"actor_user_id" uuid,
	"actor_role" text NOT NULL,
	"reason" text,
	"source_channel" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"correlation_id" text NOT NULL,
	"idempotency_key" text
);
--> statement-breakpoint
ALTER TABLE "circuit_temple" ADD CONSTRAINT "circuit_temple_circuit_id_circuit_id_fk" FOREIGN KEY ("circuit_id") REFERENCES "public"."circuit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "circuit_temple" ADD CONSTRAINT "circuit_temple_temple_id_temple_id_fk" FOREIGN KEY ("temple_id") REFERENCES "public"."temple"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_rule" ADD CONSTRAINT "entry_rule_temple_id_temple_id_fk" FOREIGN KEY ("temple_id") REFERENCES "public"."temple"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "place" ADD CONSTRAINT "place_temple_id_temple_id_fk" FOREIGN KEY ("temple_id") REFERENCES "public"."temple"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "temple_schedule" ADD CONSTRAINT "temple_schedule_temple_id_temple_id_fk" FOREIGN KEY ("temple_id") REFERENCES "public"."temple"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "temple_service" ADD CONSTRAINT "temple_service_temple_id_temple_id_fk" FOREIGN KEY ("temple_id") REFERENCES "public"."temple"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "temple_special_day" ADD CONSTRAINT "temple_special_day_temple_id_temple_id_fk" FOREIGN KEY ("temple_id") REFERENCES "public"."temple"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_time" ADD CONSTRAINT "travel_time_from_place_id_place_id_fk" FOREIGN KEY ("from_place_id") REFERENCES "public"."place"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_time" ADD CONSTRAINT "travel_time_to_place_id_place_id_fk" FOREIGN KEY ("to_place_id") REFERENCES "public"."place"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_user_role" ADD CONSTRAINT "app_user_role_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_user_role" ADD CONSTRAINT "app_user_role_granted_by_app_user_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traveller" ADD CONSTRAINT "traveller_booker_user_id_app_user_id_fk" FOREIGN KEY ("booker_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "temple_schedule_temple_idx" ON "temple_schedule" USING btree ("temple_id");--> statement-breakpoint
CREATE INDEX "temple_special_day_range_idx" ON "temple_special_day" USING btree ("temple_id","from_date","to_date");--> statement-breakpoint
CREATE UNIQUE INDEX "travel_time_pair_uq" ON "travel_time" USING btree ("from_place_id","to_place_id");--> statement-breakpoint
CREATE UNIQUE INDEX "app_user_phone_uq" ON "app_user" USING btree ("phone");--> statement-breakpoint
CREATE UNIQUE INDEX "app_user_email_uq" ON "app_user" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "traveller_booker_idx" ON "traveller" USING btree ("booker_user_id");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_log_time_idx" ON "audit_log" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "state_transition_entity_idx" ON "state_transition" USING btree ("machine","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "state_transition_idem_uq" ON "state_transition" USING btree ("idempotency_key");