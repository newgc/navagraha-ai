CREATE TABLE "gateway_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"event_key" text NOT NULL,
	"event_type" text,
	"link_id" text,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "currency" text DEFAULT 'INR' NOT NULL;--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "gateway_link_id" text;--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "gateway_link_url" text;--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "gateway_link_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "gateway_order_id" text;--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "gateway_payment_id" text;--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "gateway_response" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "gateway_event_key_uq" ON "gateway_event" USING btree ("provider","event_key");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_gateway_link_uq" ON "payment" USING btree ("gateway_link_id");--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_gateway_link_chk" CHECK ("payment"."gateway_link_id" is null or "payment"."method" = 'GATEWAY');