---
description: "Drizzle Kit commands, drizzle.config.ts, generate/migrate/push workflow. Read for migration management."
connections: [schema, connections]
---

# Migrations & Drizzle Kit

## drizzle.config.ts

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql", // "mysql" | "sqlite"
  schema: "./src/schema.ts", // or "./src/**/*.ts"
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
    // or host, port, user, password, database
  },
  // optional
  verbose: true,
  strict: true,
  migrations: {
    table: "__drizzle_migrations",
    schema: "drizzle",
  },
});
```

## Commands

| Command | Purpose | When |
|---------|---------|------|
| `npx drizzle-kit generate` | Generate SQL migration files from schema changes | After schema edits (production) |
| `npx drizzle-kit migrate` | Apply pending migrations | Deploy / CI |
| `npx drizzle-kit push` | Push schema directly to DB (no migration files) | Local development |
| `npx drizzle-kit pull` | Introspect existing DB into schema | Legacy DB onboarding |
| `npx drizzle-kit studio` | Open Drizzle Studio UI | Data browsing |
| `npx drizzle-kit check` | Validate migrations | CI |
| `npx drizzle-kit up` | Upgrade migration folder structure (v0→v1) | One-time upgrade |

## Workflow

1. Edit schema in TypeScript.
2. `npx drizzle-kit generate` → creates `drizzle/0001_xxx.sql` + meta.
3. Review SQL.
4. `npx drizzle-kit migrate` (or use `push` in dev).

## Custom Migrations

Place custom SQL in the migrations folder or use kit custom migrations support.

## Teams & Web/Mobile

See official docs for multi-dev workflows and client-side considerations.

## v1 Changes

Migrations folder structure changed (no journal.json). Run `drizzle-kit up` after installing RC packages.

See [[schema]] for what generates migrations and [[connections]] for credentials.
