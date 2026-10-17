-- RLS activo en todas las tablas y sin políticas: ni `anon` ni `authenticated` leen nada.
-- La API usa una conexión directa que omite RLS; la autorización vive en el middleware.
ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."document_chunks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."contact_channels" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."conversations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- Defensa en profundidad: además de RLS, se quitan los privilegios de tabla a los roles de la Data API.
REVOKE ALL ON TABLE
  "public"."profiles",
  "public"."documents",
  "public"."document_chunks",
  "public"."contact_channels",
  "public"."conversations",
  "public"."messages"
FROM anon, authenticated;--> statement-breakpoint

-- Alta de perfiles: cuando un administrador crea un usuario en Supabase Auth se inserta su
-- fila con rol `staff` (el valor por defecto). El primer `admin` y los cambios de rol se hacen con SQL.
CREATE OR REPLACE FUNCTION public.handle_new_staff()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, lower(NEW.email), NEW.raw_user_meta_data->>'full_name');
  RETURN NEW;
END;
$$;--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION public.handle_new_staff() FROM PUBLIC, anon, authenticated;--> statement-breakpoint

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;--> statement-breakpoint
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_staff();--> statement-breakpoint

-- Bucket privado con los originales. Solo la API sube, lee y borra con la clave de servicio;
-- las descargas usan URL firmadas de 15 minutos.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'documents',
  'documents',
  false,
  20971520,
  ARRAY[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
