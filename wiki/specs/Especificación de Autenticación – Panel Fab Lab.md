# Especificación de Autenticación – Panel Fab Lab

Oct 17, 2026 · @Diego Cancino

## 1. Resumen y alcance

La autenticación del panel se construye en dos etapas para no sobredimensionar la Fase 1: una etapa básica de correo y contraseña, para validar rápido la experiencia del panel, y una etapa productiva con Microsoft del tenant de INACAP. Ambas usan Supabase Auth, y la segunda reemplaza el método de inicio de sesión sin cambiar el middleware de la API ni la tabla `profiles`.

|  | Etapa 1: básica | Etapa 2: productiva |
| --- | --- | --- |
| Cuándo | Fase 1 (sección 8 de la [especificación de la Fase 1](https://claude.ai/code/artifact/9eed8402-a75b-45bf-be62-c52b0de630b7)) | Después de validar el panel; depende de TI de INACAP |
| Método | Supabase Auth con correo y contraseña | Supabase Auth con Microsoft (Entra ID), un solo tenant |
| Quién puede entrar | Usuarios creados por un administrador | Cuentas del tenant de INACAP incluidas en una lista de acceso |
| Alta de usuarios | Panel de Supabase | Lista `staff_allowlist`, administrada con SQL |
| Segundo factor | No | Lo define el tenant (Entra ID) |
| Roles | `admin` y `staff` | `admin` y `staff`, sin cambios |

**Fuera de alcance de este documento:** gestión de usuarios desde el panel, inicio de sesión con otros proveedores y autenticación de dispositivos o de clientes externos (por ejemplo, la API del calendario).

## 2. Etapa 1: autenticación básica

La etapa 1 queda definida en la especificación de la Fase 1; aquí se resume porque es la base sobre la que se monta la etapa 2.

1. Un administrador crea cada usuario en el panel de Supabase (correo y contraseña); el registro público está desactivado.
2. Un trigger sobre `auth.users` crea su fila en `profiles` con rol `staff`; el primer `admin` se asigna con SQL.
3. En `/login`, un formulario llama a `signInWithPassword`; la sesión viaja en cookies con `@supabase/ssr` y un middleware de la web redirige a `/login` cuando no hay sesión en `/admin/*`.
4. La API Hono verifica el JWT y la fila de `profiles` en el middleware `requireStaff`, y el rol en `requireRole('admin')` donde corresponda.

| Rol | Qué puede hacer en el panel |
| --- | --- |
| `admin` | Todo lo del panel y, cuando exista, la gestión de usuarios |
| `staff` | Documentos, Historial y Contacto |

En la Fase 1 no hay pantallas exclusivas de `admin`: el rol se guarda y se verifica en la API para que no haya que rehacer nada cuando existan.

**Se conserva en la etapa 2:** la tabla `profiles`, `requireStaff`, `requireRole`, las cookies de sesión, la verificación del JWT y todas las rutas de la API. **Cambia:** el método de inicio de sesión, el origen del alta de usuarios y la lista de acceso.

## 3. Etapa 2: requerimientos de la autenticación productiva

La etapa 2 deja entrar solo al equipo autorizado de Fab Lab con su cuenta institucional de Microsoft, sin contraseñas propias en la aplicación.

| ID | Requerimiento | Prioridad |
| --- | --- | --- |
| RA-01 | Iniciar sesión con la cuenta Microsoft institucional de un único tenant, el de INACAP | Debe |
| RA-02 | Aceptar solo correos `@inacapmail.cl` que estén en la lista de acceso `staff_allowlist` y rechazar el resto antes de crear el usuario | Debe |
| RA-03 | Asignar al perfil, al crearse, el rol (`admin` o `staff`) que figura en la lista | Debe |
| RA-04 | Revocar el acceso de inmediato al quitar a una persona de la lista, verificándola en cada petición a la API | Debe |
| RA-05 | Mostrar un mensaje claro y genérico cuando la cuenta no está autorizada | Debe |
| RA-06 | Retirar el inicio de sesión con correo y contraseña al pasar a producción | Debe |
| RA-07 | Aprovechar el segundo factor y las políticas de acceso condicional del tenant, sin implementarlos en la aplicación | Debería |
| RA-08 | Administrar la lista de acceso desde el panel, solo para `admin` | Podría |

**El dominio no basta.** Si `@inacapmail.cl` lo comparten estudiantes u otras áreas de INACAP, cualquiera de ellos podría completar el inicio de sesión de Microsoft. Por eso el acceso lo decide `staff_allowlist` y el dominio es solo un primer filtro. Conviene confirmar con TI de INACAP cómo se organizan los dominios y el tenant.

## 4. Flujo de inicio de sesión

&#91;embedded content: flujo de inicio de sesión · Microsoft, hook y lista de acceso\]

El hook corre antes de crear el usuario, y `requireStaff` vuelve a verificar la lista en cada petición, de modo que una baja surte efecto de inmediato.

## 5. Decisión: Supabase Auth, no Better Auth

Ambas opciones cubren Microsoft de un solo tenant; Supabase Auth encaja mejor con la arquitectura ya definida y con la etapa 1.

| Criterio | Supabase Auth | Better Auth |
| --- | --- | --- |
| Encaje con la arquitectura | Ya forma parte de Supabase y ya se usa en la etapa 1: `profiles` se alimenta desde `auth.users`, la API verifica el JWT con las claves públicas del proyecto y la web usa `@supabase/ssr` | Sería un segundo sistema de identidad junto a Supabase, con sus propias tablas (usuario, sesión, cuenta) en el esquema de Drizzle y su propio manejo de sesiones en Hono |
| Microsoft de un solo tenant | Proveedor `azure` con «Azure Tenant URL» (`https://login.microsoftonline.com/<tenant-id>`), que limita el acceso a las cuentas de ese tenant | Soportado con `tenantId` y la sugerencia de dominio `domain_hint` |
| Bloquear cuentas fuera de la lista | Hook «Before User Created» (función Postgres) que rechaza el alta antes de crear el usuario | Habría que programar y mantener hooks propios de creación de usuario |
| Paso de la etapa 1 a la 2 | Se agrega un proveedor y un hook; `requireStaff` y `profiles` no cambian | Exigiría migrar los usuarios y las sesiones de la etapa 1 a otro sistema |
| Código y operación | Sin servidor de autenticación propio; se configura en el panel de Supabase | Más código y más superficie a mantener, incluidas migraciones de identificadores de cuenta entre versiones |
| Salir de Supabase más adelante | Queda atada a Supabase | Es portable |

Se elige Supabase Auth porque ya está en la arquitectura, resuelve el tenant único y el filtro de altas sin código adicional y evita duplicar la identidad. Better Auth tendría sentido si se quisiera dejar de depender de Supabase o necesitar sesiones propias; no es el caso.

## 6. Configuración e implementación de la etapa 2

**Configuración externa**

1. **Microsoft Entra ID**, a cargo de TI de INACAP: registrar una aplicación para «solo esta organización» (un único tenant), con el URI de redirección web `https://<project-ref>.supabase.co/auth/v1/callback`, y crear un secreto de cliente cuyo vencimiento se anota en un calendario para renovarlo a tiempo.
2. **Claim `xms_edov`**: agregarlo, junto con `email`, como claim opcional en el manifiesto de la aplicación. Supabase lo recomienda porque las aplicaciones de un solo tenant pueden recibir correos de dominios no verificados.
3. **Supabase Auth, proveedor Azure**: activarlo con el Client ID, el secreto y el «Azure Tenant URL» con el identificador del tenant; agregar `/auth/callback` a las URL de redirección permitidas. Estos valores se configuran en Supabase, no en variables de entorno de la aplicación.
4. **Lista de acceso**: crear `staff_allowlist` y activar la función del hook como «Before User Created» (código siguiente).
5. **Desarrollo local**: Azure no admite `127.0.0.1` como URI de redirección, así que se usa `localhost` y `external_url = "http://localhost:54321"` en `config.toml`.

**Modelo de datos.** Se agrega una tabla y, desde la etapa 2, el rol se lee de ella en cada petición, de modo que `staff_allowlist` pasa a ser la única fuente del rol; `profiles.role` deja de usarse y se elimina en una migración posterior.

```ts
// packages/db/src/schema.ts: se agrega en la etapa 2
export const staffAllowlist = pgTable('staff_allowlist', {
  email: text('email').primaryKey(), // en minúsculas, por ejemplo nombre.apellido@inacapmail.cl
  role: text('role', { enum: ['admin', 'staff'] }).notNull().default('staff'),
  addedBy: uuid('added_by').references(() => profiles.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
});
```

```sql
-- migración personalizada (drizzle-kit generate --custom)
create or replace function public.hook_staff_allowlist(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(event->'user'->>'email');
begin
  if v_email is null
     or v_email not like '%@inacapmail.cl'
     or not exists (select 1 from public.staff_allowlist where email = v_email) then
    return jsonb_build_object('error', jsonb_build_object(
      'message', 'Esta cuenta no está autorizada para usar el panel de Fab Lab.',
      'http_code', 403));
  end if;
  return '{}'::jsonb;
end;
$$;

grant execute on function public.hook_staff_allowlist to supabase_auth_admin;
revoke execute on function public.hook_staff_allowlist from authenticated, anon, public;

-- el perfil se crea con el correo; el rol ya no se copia desde la lista
drop trigger if exists on_auth_user_created on auth.users;

create or replace function public.handle_new_staff()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, lower(new.email), new.raw_user_meta_data->>'full_name');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_staff();
```

**Cambios en la web.** `/login` reemplaza el formulario por el botón «Iniciar sesión con Microsoft» y se agrega la ruta `/auth/callback`, que intercambia el código por la sesión con `exchangeCodeForSession` y redirige a `/admin`.

```ts
// apps/web/src/app/login/login-button.tsx (ilustrativo)
await supabase.auth.signInWithOAuth({
  provider: 'azure',
  options: {
    scopes: 'email',
    redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback`,
  },
});
```

**Cambios en la API.** `requireStaff` deja de buscar el perfil solo en `profiles` y exige también la entrada vigente en la lista; así, quitar a alguien de `staff_allowlist` revoca su acceso en la siguiente petición.

```ts
// packages/server/src/middleware/require-staff.ts: etapa 2, ilustrativo
const [row] = await db
  .select({ role: staffAllowlist.role })
  .from(profiles)
  .innerJoin(staffAllowlist, eq(staffAllowlist.email, profiles.email))
  .where(eq(profiles.id, userId));

if (!row) return c.json({ error: { code: 'forbidden', message: 'Cuenta no autorizada' } }, 403);
c.set('role', row.role); // lo usa requireRole('admin')
```

El correo que envía Entra ID lo administra el tenant de INACAP, una parte de confianza; si más adelante se quiere una garantía mayor, la lista puede atarse al identificador del usuario en Microsoft tras su primer ingreso.

## 7. Migración de la etapa 1 a la 2

El paso a la etapa 2 cambia el método de inicio de sesión y el origen del alta; todo lo demás se conserva.

| Pieza | Etapa 1 | Etapa 2 | Qué se hace |
| --- | --- | --- | --- |
| Inicio de sesión | Correo y contraseña | Microsoft | Cambia `/login` y se agrega `/auth/callback` |
| Alta de usuarios | Panel de Supabase | `staff_allowlist` y hook | Tabla nueva y hook «Before User Created» |
| Rol | `profiles.role` | `staff_allowlist.role` | `requireStaff` lee el rol de la lista |
| Sesión (cookies y JWT) | Supabase Auth | Supabase Auth | Sin cambios |
| `profiles`, rutas de la API y `requireRole` | Igual | Igual | Sin cambios |
| Contraseñas | Gestionadas por Supabase | Se desactivan | Se apaga el proveedor de correo y contraseña |

**Plan de trabajo.** La parte de desarrollo se estima en 3 a 5 días, a validar; la dependencia crítica es el tiempo de TI de INACAP, por lo que su solicitud se hace mientras se valida la etapa 1.

1. Pedir a TI de INACAP el registro de la aplicación en Entra ID, con los datos de la sección 6.
2. Configurar Azure en el proyecto de Supabase de pruebas y probar con cuentas reales y no autorizadas.
3. Crear `staff_allowlist` con los correos del equipo y los mismos roles de la etapa 1; activar el hook y el nuevo trigger.
4. Cambiar `/login`, agregar `/auth/callback` y actualizar `requireStaff`.
5. Verificar los criterios de la sección 8 en pruebas y repetirlos en producción.
6. Corte: desactivar el proveedor de correo y contraseña en Supabase.

**Usuarios de la etapa 1.** Conservan su fila en `profiles`. Al primer ingreso con Microsoft, Supabase decide si vincula la identidad nueva con el usuario existente (mismo correo) o crea otro usuario; ese comportamiento de vinculación de identidades se confirma en el ambiente de pruebas antes del corte. Si no vinculara, la alternativa es eliminar los usuarios de la etapa 1 antes del corte para que se creen de nuevo. La Fase 1 lo permite porque `documents.uploaded_by` se define con `on delete set null`: los documentos no se pierden, solo la referencia de quién los subió.

## 8. Seguridad y criterios de aceptación

El criterio central de la etapa 2 es que una cuenta de `@inacapmail.cl` que no esté en la lista nunca llegue a tener acceso, aunque complete el inicio de sesión de Microsoft.

| Riesgo | Control |
| --- | --- |
| Cuentas del mismo dominio que no son del equipo | `@inacapmail.cl` es solo un primer filtro; decide `staff_allowlist`, aplicada en el hook y verificada de nuevo en cada petición |
| Acceso de cuentas de otro tenant o personales | «Azure Tenant URL» limita el acceso al tenant de INACAP y la aplicación se registra para una sola organización |
| Correos no verificados de Entra ID | Claim opcional `xms_edov` configurado en la aplicación, como recomienda Supabase para aplicaciones de un solo tenant |
| Acceso que sobrevive a una baja | `requireStaff` consulta la lista en cada petición, así que quitar el correo revoca el acceso de inmediato |
| Omisión de RLS por la conexión directa de Drizzle | La autorización vive en el middleware de la API; RLS queda activo sin políticas para `anon` y `authenticated` |
| Vencimiento o filtración del secreto de cliente | Vive solo en Supabase; su vencimiento se registra en un calendario con recordatorio |
| Segundo factor y acceso condicional | Los aplica Entra ID según la política de INACAP, no la aplicación |

| N.º | Criterio de aceptación | Cómo se verifica | Requerimiento |
| --- | --- | --- | --- |
| 1 | Una cuenta de la lista inicia sesión con Microsoft y entra al panel con el rol de la lista | Prueba manual con una cuenta `admin` y una `staff` | RA-01, RA-03 |
| 2 | Una cuenta de `@inacapmail.cl` que no está en la lista es rechazada con un mensaje claro y no se crea su usuario | Prueba manual y prueba automatizada del hook | RA-02, RA-05 |
| 3 | Una cuenta de otro tenant y una cuenta personal de Microsoft son rechazadas | Prueba manual con dos cuentas | RA-01 |
| 4 | Al quitar un correo de la lista, la persona recibe 403 en su siguiente petición a la API | Prueba automatizada | RA-04 |
| 5 | Con el proveedor de correo y contraseña apagado, `/login` solo ofrece Microsoft y el inicio con contraseña falla | Prueba manual tras el corte | RA-06 |
| 6 | Una cuenta `staff` no puede usar rutas exclusivas de `admin` | Prueba automatizada por ruta | RA-03 |

## 9. Riesgos, decisiones abiertas y preguntas

El mayor riesgo no es técnico: la etapa 2 depende de que TI de INACAP registre la aplicación en su tenant, y eso hay que pedirlo con anticipación.

**Riesgos**

| Riesgo | Probabilidad | Impacto | Mitigación |
| --- | --- | --- | --- |
| Dependencia de TI de INACAP para registrar la aplicación y dar el consentimiento | Media | Alto | Pedir el registro mientras se valida la etapa 1, con los datos necesarios (URI de redirección y permisos básicos de inicio de sesión y correo); desarrollar con un tenant de pruebas |
| El dominio @inacapmail.cl lo comparten estudiantes u otras áreas | Media | Alto | El acceso lo decide la lista de acceso, no el dominio |
| El secreto de cliente vence y deja a todo el equipo sin acceso | Media | Medio | Fecha de vencimiento en un calendario con recordatorio y renovación anticipada |
| La etapa 1 se queda como solución definitiva | Media | Medio | El paso a la etapa 2 es condición para dar acceso a más personas que el equipo de validación |
| La vinculación de identidades no une al usuario de la etapa 1 con el de Microsoft | Media | Bajo | Probarlo antes del corte; alternativa de recrear los usuarios (sección 7) |

**Decisiones abiertas**

| Decisión | Recomendación | Quién decide |
| --- | --- | --- |
| Tenant de INACAP y registro en Entra ID | Obtener el identificador del tenant y definir quién registra la aplicación y renueva el secreto de cliente | TI de INACAP y equipo técnico |
| Momento del corte a la etapa 2 | Antes de dar acceso al panel a más personas que el equipo de validación | Fab Lab y equipo técnico |
| Administración de la lista de acceso | SQL al inicio; pantalla para `admin` (RA-08) si el equipo la necesita | Fab Lab |
| Segundo factor | Lo define la política del tenant de INACAP; confirmar si exige MFA a estas cuentas | TI de INACAP |

**Preguntas para TI de INACAP y Fab Lab**

1. ¿Quién de TI de INACAP puede registrar la aplicación en Microsoft Entra ID, entregar el identificador del tenant y renovar el secreto de cliente?
2. ¿El dominio `@inacapmail.cl` lo usan también estudiantes u otras áreas? ¿Existe otro dominio para el personal?
3. ¿INACAP permite que una aplicación de Fab Lab use el inicio de sesión de su tenant o exige un proceso de aprobación formal?
4. ¿Quiénes serán las primeras personas de la lista de acceso, con qué correo y qué rol?
5. ¿El tenant exige segundo factor a estas cuentas?

**Fuentes** (páginas consultadas el 17 de octubre de 2026)

- [Supabase: inicio de sesión con Azure (Microsoft)](https://supabase.com/docs/guides/auth/social-login/auth-azure)
- [Supabase: hook Before User Created](https://supabase.com/docs/guides/auth/auth-hooks/before-user-created-hook)
- [Better Auth: Microsoft](https://better-auth.com/docs/authentication/microsoft)
