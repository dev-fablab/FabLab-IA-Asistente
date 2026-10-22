CREATE TABLE "contact_methods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"type" text NOT NULL,
	"value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_methods_type_check" CHECK ("contact_methods"."type" in ('phone', 'email', 'whatsapp', 'address', 'web', 'social'))
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "source" text DEFAULT 'chat' NOT NULL;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "contact_methods" ADD CONSTRAINT "contact_methods_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contact_methods_contact_idx" ON "contact_methods" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_methods_unique_idx" ON "contact_methods" USING btree ("contact_id","type",lower("value"));--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_source_check" CHECK ("contacts"."source" in ('chat', 'in_person', 'phone', 'whatsapp', 'email', 'social', 'other'));--> statement-breakpoint

-- Mismo patrón que el resto: RLS activo sin políticas y sin privilegios para los roles de la Data API.
ALTER TABLE "public"."contact_methods" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "public"."contact_methods" FROM anon, authenticated;
