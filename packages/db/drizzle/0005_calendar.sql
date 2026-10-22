CREATE TABLE "availability_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"kind" text NOT NULL,
	"start_minute" integer,
	"end_minute" integer,
	"note" text,
	CONSTRAINT "availability_exceptions_kind_check" CHECK ("availability_exceptions"."kind" in ('closed', 'open')),
	CONSTRAINT "availability_exceptions_window_check" CHECK (("availability_exceptions"."start_minute" is null and "availability_exceptions"."end_minute" is null and "availability_exceptions"."kind" = 'closed')
        or ("availability_exceptions"."start_minute" >= 0 and "availability_exceptions"."end_minute" <= 1440 and "availability_exceptions"."start_minute" < "availability_exceptions"."end_minute"))
);
--> statement-breakpoint
CREATE TABLE "availability_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"weekday" integer NOT NULL,
	"start_minute" integer NOT NULL,
	"end_minute" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "availability_rules_weekday_check" CHECK ("availability_rules"."weekday" between 0 and 6),
	CONSTRAINT "availability_rules_window_check" CHECK ("availability_rules"."start_minute" >= 0 and "availability_rules"."end_minute" <= 1440 and "availability_rules"."start_minute" < "availability_rules"."end_minute")
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meeting_minutes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"content" text NOT NULL,
	"source" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meeting_minutes_source_check" CHECK ("meeting_minutes"."source" in ('agent', 'staff'))
);
--> statement-breakpoint
CREATE TABLE "meetings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"conversation_id" uuid,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"reason" text NOT NULL,
	"conversation_summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meetings_status_check" CHECK ("meetings"."status" in ('scheduled', 'cancelled', 'completed')),
	CONSTRAINT "meetings_range_check" CHECK ("meetings"."starts_at" < "meetings"."ends_at")
);
--> statement-breakpoint
ALTER TABLE "meeting_minutes" ADD CONSTRAINT "meeting_minutes_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "availability_exceptions_date_idx" ON "availability_exceptions" USING btree ("date");--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_email_lower_idx" ON "contacts" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "meeting_minutes_meeting_idx" ON "meeting_minutes" USING btree ("meeting_id","sort_order");--> statement-breakpoint
CREATE INDEX "meetings_starts_at_idx" ON "meetings" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "meetings_contact_idx" ON "meetings" USING btree ("contact_id");--> statement-breakpoint

-- Dos reuniones `scheduled` no pueden solaparse. Es la garantía final contra la doble reserva
-- (la revalidación dentro de la transacción solo cubre el caso común).
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_no_overlap"
  EXCLUDE USING gist (tstzrange("starts_at", "ends_at") WITH &&) WHERE ("status" = 'scheduled');--> statement-breakpoint

-- Mismo patrón que `0002`: RLS activo sin políticas y sin privilegios para los roles de la Data API.
ALTER TABLE "public"."contacts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."availability_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."availability_exceptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."meetings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."meeting_minutes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

REVOKE ALL ON TABLE
  "public"."contacts",
  "public"."availability_rules",
  "public"."availability_exceptions",
  "public"."meetings",
  "public"."meeting_minutes"
FROM anon, authenticated;--> statement-breakpoint

-- Horario base inicial: lunes a viernes de 08:00 a 20:00. El equipo lo edita desde el panel.
INSERT INTO "availability_rules" ("weekday", "start_minute", "end_minute")
SELECT d, 480, 1200 FROM generate_series(1, 5) AS d;
