---
description: "Database connection setup for PostgreSQL, MySQL, SQLite and serverless providers. Read when configuring drizzle() client."
connections: [migrations]
---

# Connections & Drivers

Drizzle works with standard drivers. No special adapters required for most cases.

## PostgreSQL

**node-postgres (pg)**:
```bash
npm i drizzle-orm pg
npm i -D @types/pg
```
```ts
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool);
// or drizzle({ client: pool })
```

**postgres.js**:
```bash
npm i drizzle-orm postgres
```
```ts
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
const queryClient = postgres(process.env.DATABASE_URL);
export const db = drizzle(queryClient);
```

## MySQL

```bash
npm i drizzle-orm mysql2
```
```ts
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
const connection = await mysql.createConnection(process.env.DATABASE_URL!);
export const db = drizzle(connection);
```

## SQLite

```bash
npm i drizzle-orm better-sqlite3
```
```ts
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
const sqlite = new Database("sqlite.db");
export const db = drizzle(sqlite);
```

## Serverless / Hosted

| Provider | Import | Notes |
|----------|--------|-------|
| Neon | `drizzle-orm/neon-http` or serverless | `@neondatabase/serverless` |
| PlanetScale | `drizzle-orm/planetscale-serverless` | |
| Supabase | Standard pg or their client | |
| Cloudflare D1 | `drizzle-orm/d1` | |
| Turso / libSQL | `drizzle-orm/libsql` | |
| Vercel Postgres | Standard or neon | |
| AWS Data API | `drizzle-orm/aws-data-api/pg` | |

Always pass schema for full type inference:

```ts
import * as schema from "./schema";
export const db = drizzle(client, { schema });
```

For read replicas, transactions, and advanced: see official docs.

See [[migrations]] for config that uses the same credentials.
