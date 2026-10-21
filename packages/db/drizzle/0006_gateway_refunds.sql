ALTER TYPE "public"."refund_method" ADD VALUE 'GATEWAY';--> statement-breakpoint
ALTER TABLE "refund" ALTER COLUMN "reference" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "refund" ALTER COLUMN "paid_on" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "refund" ADD COLUMN "payment_id" uuid;--> statement-breakpoint
ALTER TABLE "refund" ADD COLUMN "approved_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "refund" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "refund" ADD COLUMN "gateway_refund_id" text;--> statement-breakpoint
ALTER TABLE "refund" ADD COLUMN "gateway_status" text;--> statement-breakpoint
ALTER TABLE "refund" ADD COLUMN "gateway_response" jsonb;--> statement-breakpoint
ALTER TABLE "refund" ADD COLUMN "sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "refund" ADD CONSTRAINT "refund_payment_id_payment_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund" ADD CONSTRAINT "refund_approved_by_user_id_app_user_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "refund_gateway_id_uq" ON "refund" USING btree ("gateway_refund_id");--> statement-breakpoint
ALTER TABLE "refund" ADD CONSTRAINT "refund_approval_two_person_chk" CHECK ("refund"."approved_by_user_id" is null or "refund"."initiated_by_user_id" is null or "refund"."approved_by_user_id" <> "refund"."initiated_by_user_id");--> statement-breakpoint
ALTER TABLE "refund" ADD CONSTRAINT "refund_method_details_chk" CHECK (("refund"."method"::text = 'GATEWAY' and "refund"."payment_id" is not null and "refund"."gateway_refund_id" is not null)
        or ("refund"."method"::text <> 'GATEWAY' and "refund"."reference" is not null and "refund"."paid_on" is not null));