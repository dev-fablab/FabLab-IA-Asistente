---
name: drizzle-orm
description: "TypeScript ORM for PostgreSQL, MySQL, SQLite and serverless databases. Use when defining schemas, writing type-safe queries, generating migrations with drizzle-kit, connecting drivers, or using Relational Queries API. Prefer this over general ORM knowledge for Drizzle-specific APIs, column builders, and kit commands."
type: knowledge
lifecycle: active
---

# Drizzle ORM — Headless TypeScript ORM

Lightweight (~7.4kb), zero-dependency, SQL-like TypeScript ORM. Serverless-ready, tree-shakeable. Supports PostgreSQL, MySQL, SQLite and variants (Neon, PlanetScale, Supabase, Turso, Cloudflare D1, etc.).

Use for schema definition in TS, type-safe queries (SQL-like or Relational Queries API), migrations via Drizzle Kit, and integrations with Zod/Valibot.

**Prefer official docs for latest details**: https://orm.drizzle.team/docs

## Quick Start

1. Install (stable or RC for v1 features):
   ```bash
   npm i drizzle-orm pg          # or postgres, mysql2, better-sqlite3, etc.
   npm i -D drizzle-kit @types/pg
   # For v1 RC: drizzle-orm@rc drizzle-kit@rc
   ```

2. Define schema (`schema.ts`):
   ```ts
   import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

   export const users = pgTable("users", {
     id: serial("id").primaryKey(),
     name: text("name").notNull(),
     email: text("email").unique(),
     createdAt: timestamp("created_at").defaultNow(),
   });
   ```

3. Connect:
   ```ts
   import { drizzle } from "drizzle-orm/node-postgres";
   import { Pool } from "pg";
   const pool = new Pool({ connectionString: process.env.DATABASE_URL });
   export const db = drizzle(pool);
   ```

4. Query:
   ```ts
   import { eq } from "drizzle-orm";
   const result = await db.select().from(users).where(eq(users.id, 1));
   await db.insert(users).values({ name: "Dan", email: "dan@example.com" });
   ```

5. Migrations (`drizzle.config.ts` + kit):
   ```ts
   import { defineConfig } from "drizzle-kit";
   export default defineConfig({
     dialect: "postgresql",
     schema: "./src/schema.ts",
     out: "./drizzle",
     dbCredentials: { url: process.env.DATABASE_URL! },
   });
   ```
   ```bash
   npx drizzle-kit generate   # create SQL migrations
   npx drizzle-kit migrate    # apply
   # or npx drizzle-kit push  # direct push (dev)
   ```

## Core Workflows

### Schema
See `references/schema.md` for column types, indexes, constraints, enums, schemas, reusable columns.

### Queries (SQL-like)
See `references/queries.md` for select/insert/update/delete, filters, joins, aggregations, sql`` operator.

### Relational Queries API
Define relations then use `db.query.*.findMany({ with: ... })`. See `references/relational.md`.

### Connections & Drivers
PostgreSQL (pg, postgres.js), MySQL, SQLite, serverless adapters. See `references/connections.md`.

### Migrations & Kit
generate / migrate / push / pull / studio. See `references/migrations.md`.

### Upgrade to v1
`npm i drizzle-orm@rc drizzle-kit@rc` then `npx drizzle-kit up`. Review breaking changes at docs/upgrade-v1.

## Key Principles
- Headless: library, not a framework. No forced project structure.
- SQL-like schema and queries (with relational alternative).
- Outputs exactly one SQL query. Zero runtime deps.
- Full TypeScript inference.

## Common Issues
| Issue | Fix |
|-------|-----|
| Types not inferred | Ensure schema exported and passed to drizzle() if needed; check dialect import (`pg-core` vs `mysql-core`). |
| Migration not detecting changes | Export all tables; check `schema` path in config; run `generate` after schema edit. |
| Relational queries fail | Must call `defineRelations` and pass relations to `drizzle({ schema, relations })`. |
| Serverless connection limits | Use connection pooling or serverless drivers (Neon, PlanetScale). |
| v0 → v1 | Run `drizzle-kit up`; update Relational Queries to v2; check docs for breaking changes. |

## Knowledge Graph
Start at `references/INDEX.md` for navigation across detailed references.

## References
- Schema declaration & column types → `references/schema.md`
- SQL-like queries & operators → `references/queries.md`
- Relational Queries (RQB) → `references/relational.md`
- Database connections & drivers → `references/connections.md`
- Drizzle Kit & migrations → `references/migrations.md`
- Validations (Zod etc.) → docs/zod
- Performance & advanced → docs/perf-queries, docs/transactions
