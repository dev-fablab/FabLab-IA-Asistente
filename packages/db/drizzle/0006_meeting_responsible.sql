ALTER TABLE "meetings" ADD COLUMN "responsible_id" uuid;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_responsible_id_profiles_id_fk" FOREIGN KEY ("responsible_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meetings_responsible_idx" ON "meetings" USING btree ("responsible_id");