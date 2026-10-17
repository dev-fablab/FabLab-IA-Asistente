# Asistente Virtual Fab Lab

Chat público que responde **solo con la documentación oficial de Fab Lab**, panel para que el equipo cargue esa documentación y un historial de todas las conversaciones. Especificación completa: [`wiki/development/Especificación Fase 1 – Asistente Virtual Fab Lab.md`](wiki/development/Especificación%20Fase%201%20–%20Asistente%20Virtual%20Fab%20Lab.md).

**Estado:** Fase 1, hitos 1 a 4 implementados (base y auth, ingesta de documentos, agente y chat, historial y contacto). Falta el hito 5: calibración con documentos reales, carga y despliegue (ver [Pendiente](#pendiente)).

## Stack

Next.js 16 (web y panel) · Hono (API, montada en `app/api`) · Mastra (agente, con storage en Postgres) · Drizzle ORM + Supabase (Postgres con pgvector, Auth y Storage) · OpenRouter (chat) y NVIDIA NIM (embeddings) · Assistant UI (chat).

```text
apps/web          Next.js: chat público (/), login (/login) y panel (/admin/*). Monta la API.
packages/server   App Hono: rutas, middleware (JWT, límite de tasa), ingesta e historial. Sin Next.js.
packages/agent    Agente de Mastra, herramientas, instrucciones y modelos. Sin Next.js ni Hono.
packages/db       Esquema de Drizzle, migraciones y acceso a Storage.
tests/eval        Evaluación del agente contra un conjunto de preguntas.
supabase/         Configuración de Supabase local.
```

## Puesta en marcha

Requisitos: Node ≥ 22.13, pnpm 12 y Docker.

```bash
pnpm install
pnpm supabase:start            # Postgres + pgvector, Auth y Storage locales (la primera vez descarga imágenes)
cp .env.example apps/web/.env.local
```

Completa `apps/web/.env.local`. Con Supabase local, `pnpm supabase status` muestra la URL y las claves; usa `http://localhost:54321` (no `127.0.0.1`) para `SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_URL`. De los modelos solo faltan tus claves: `OPENROUTER_API_KEY` (de [openrouter.ai/keys](https://openrouter.ai/keys), para el chat) y `NVIDIA_API_KEY` (de [build.nvidia.com](https://build.nvidia.com), solo para los embeddings). `CHAT_MODELS` (el principal y sus respaldos) y `EMBEDDING_MODEL` ya vienen en `.env.example`.

```bash
pnpm db:migrate                                              # aplica las migraciones de Drizzle
pnpm models:check                                            # verifica las claves y los modelos (opcional, recomendado)
pnpm db:seed-admin --email tu@correo.cl --password "<mínimo 12 caracteres>"   # primer administrador
pnpm dev                                                     # http://localhost:3000
```

El registro público de Supabase Auth está desactivado: los usuarios del panel los crea un administrador (el script anterior, o el panel de Supabase). El trigger de la base les asigna el rol `staff`; los cambios de rol se hacen con SQL.

## Scripts

| Comando | Qué hace |
| --- | --- |
| `pnpm dev` / `pnpm build` | Servidor de desarrollo / build de producción |
| `pnpm typecheck` · `pnpm lint` | Tipos (TypeScript estricto) y ESLint |
| `pnpm test` | Pruebas unitarias y de componentes (no necesitan servicios) |
| `pnpm test:integration` | Integración contra Supabase local (Postgres, Auth y Storage reales) |
| `pnpm models:check` | Verifica con las APIs reales: embeddings (NVIDIA), que cada modelo de chat llame herramientas y termine sin cortarse, y el respaldo |
| `pnpm eval` | Evaluación del agente con modelos reales (necesita las claves de los modelos y documentos cargados) |
| `pnpm db:generate` · `pnpm db:migrate` | Genera y aplica migraciones de Drizzle |
| `pnpm supabase:start` · `pnpm supabase:stop` | Supabase local |

## Qué cubren las pruebas

- **Unitarias y de componentes:** validación de archivos, extracción de PDF y DOCX reales, troceo, saneado del hilo, límite de tasa, `requireStaff` y las pantallas del panel y del chat (con el runtime real de Assistant UI y respuestas de stream grabadas del servidor).
- **Integración:** flujo completo de documentos, chat con un modelo simulado (herramientas reales, streaming, historial, marca «sin información»), historial y contacto, y que la clave pública no lea ninguna tabla ni objeto de Storage.
- **No cubren** (necesitan un modelo real o un navegador): la calidad de las respuestas con los modelos reales, embeddings reales y pruebas de extremo a extremo en navegador. `pnpm models:check` y `pnpm eval` son las verificaciones con la API real.

## Decisiones que se apartan del spec

- **Chat con OpenRouter; embeddings con NVIDIA NIM.** NIM se saturaba con el chat, así que el chat pasó a OpenRouter (`openrouter/anthropic/claude-haiku-5.5` con respaldo `openrouter/openai/gpt-6-luna`). Chat con respaldos: `CHAT_MODELS` es una lista en orden de prioridad (`openrouter/<organización>/<modelo>`, formato del enrutador de Mastra, que lee `OPENROUTER_API_KEY`; cada proveedor exige su clave) y Mastra pasa al siguiente si el modelo falla, cada uno con 2 reintentos. Embeddings con `baai/bge-m3` (1024 dimensiones, multilingüe): **la columna `vector` pasó de 1536 a 1024** (migración `0003`, que vacía los fragmentos y deja los documentos en «falló» para reindexarlos con «Reintentar»). El umbral `RETRIEVAL_MIN_SCORE=0,70` se pensó para otro modelo: `pnpm models:check` imprime las similitudes de `bge-m3` para recalibrarlo. Los modelos de razonamiento cuentan su razonamiento dentro del tope de salida: si las respuestas salen cortadas, sube `CHAT_MAX_OUTPUT_TOKENS`.
- **Mastra con storage en Postgres (esquema `mastra`).** Evita el aviso de storage en memoria y deja listo lo que Mastra persiste por su cuenta (workflows, trazas, evaluaciones). El agente sigue **sin `memory`**: `conversations` y `messages` son la única fuente de verdad del historial y Mastra no guarda mensajes ni hilos (hay una prueba que lo exige). Las tablas de Mastra viven aparte de las de Drizzle, sin permisos para `anon`/`authenticated`, con RLS y fuera de la Data API: **no agregues `mastra` a los «exposed schemas» de Supabase.** El criterio 11 del spec («no existen tablas `mastra_*`») pasa a significar «no existen en `public`».
- **`.pnpmfile.cjs`:** quita `pg` de los peers de `drizzle-orm`. Sin eso, instalar `@mastra/pg` duplica `drizzle-orm` y los tipos de `db` y `agent` dejan de ser compatibles.
- **Límite de tasa en memoria, sin Upstash.** Detrás de la interfaz `RateLimiter`. En Vercel cada instancia tiene su propia memoria, así que el límite de 15 mensajes cada 5 minutos y 100 por día es *por instancia* (control parcial). Controles que acotan el costo igual: 2.000 caracteres por mensaje, 800 tokens de salida, 20 mensajes de contexto y el **tope de gasto de tu cuenta de OpenRouter, que hay que fijar a mano** (los respaldos multiplican los intentos si un modelo falla). Cambiar a Upstash o a una tabla en Postgres es otra implementación de la misma interfaz.
- **`proxy.ts` en lugar de `middleware.ts`:** Next.js 16 lo renombró.
- **TypeScript 6.0.3 fijo:** `typescript-eslint` aún no admite la 7.x.
- **Cliente de Storage en `packages/db`** (lo usan `server` y `agent`) y **agendador en segundo plano inyectado** en `createApp`, para que `packages/server` no importe Next.js.
- **Rutas añadidas:** `GET /api/chat/contact` (canales activos, para mostrarlos si el modelo falla).
- Tamaño de fragmento de 512 **caracteres** (no tokens): valor inicial del spec, a calibrar.

## Pendiente

- Correr `pnpm models:check` y luego `pnpm eval` con documentos reales: los criterios de aceptación 1 a 5 del spec dependen de los modelos reales (aún no se han verificado con los modelos reales). En particular, comprobar que los modelos de `CHAT_MODELS` llaman herramientas.
- Conjunto de evaluación: `tests/eval/questions.json` es **provisional**; Fab Lab arma las 30 preguntas reales (hay 12 huecos de cobertura marcados como pendientes).
- Texto del aviso de privacidad (`apps/web/src/lib/chat/copy.ts`): validarlo con Fab Lab y asesoría legal antes de publicar.
- Hito 5: calibrar `RETRIEVAL_MIN_SCORE`, `RETRIEVAL_TOP_K` y el troceo; prueba de carga; revisión de seguridad; despliegue a Vercel y Supabase de producción; logo y colores.
