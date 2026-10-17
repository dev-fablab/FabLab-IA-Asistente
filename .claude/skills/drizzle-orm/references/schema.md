---
description: "Schema declaration patterns, column types, indexes, constraints, enums for Drizzle ORM. Read when defining or modifying tables."
connections: [queries, relational, migrations]
---

# Schema Declaration

Import from dialect core: `drizzle-orm/pg-core`, `mysql-core`, `sqlite-core`.

## Basic Table

```ts
import { pgTable, serial, text, integer, timestamp, boolean, jsonb, uuid } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  uuid: uuid("uuid").defaultRandom().primaryKey(), // alternative
  name: text("name").notNull(),
  email: text("email").unique().notNull(),
  age: integer("age"),
  isActive: boolean("is_active").default(true),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()),
});
```

## Column Types (PostgreSQL examples)

| Type | Builder | Notes |
|------|---------|-------|
| Integer | `integer()`, `serial()`, `bigint()`, `bigserial()` | Auto-increment via serial or `.generatedAlwaysAsIdentity()` |
| Text | `text()`, `varchar({ length: 255 })`, `char()` | |
| Boolean | `boolean()` | |
| Timestamp | `timestamp()`, `date()`, `time()` | `{ withTimezone: true, precision: 3 }` |
| UUID | `uuid()` | `.defaultRandom()` |
| JSON | `json()`, `jsonb()` | |
| Numeric | `numeric()`, `decimal({ precision: 10, scale: 2 })`, `real()`, `doublePrecision()` | |
| Enum | `pgEnum("status", ["draft", "published"])` then `statusEnum()` | |
| Array | `integer().array()` | PostgreSQL |

## Constraints & Indexes

```ts
export const posts = pgTable("posts", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  authorId: integer("author_id").references(() => users.id, { onDelete: "cascade" }),
  slug: text("slug").unique(),
}, (table) => [
  index("title_idx").on(table.title),
  uniqueIndex("slug_unique").on(table.slug),
  check("title_length", sql`length(${table.title}) > 0`),
]);
```

## Enums

```ts
export const roleEnum = pgEnum("role", ["user", "admin", "moderator"]);
// then
role: roleEnum().default("user").notNull(),
```

## Schemas (PostgreSQL)

```ts
import { pgSchema } from "drizzle-orm/pg-core";
const auth = pgSchema("auth");
export const sessions = auth.table("sessions", { ... });
```

## Reusable Columns

```ts
const timestamps = {
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()),
};

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  ...timestamps,
});
```

## Naming

Use `.notNull()`, `.default()`, `.primaryKey()`, `.unique()`, `.references()`.

For camelCase ↔ snake_case, configure casing in drizzle.config or use explicit names.

See also [[queries]] for querying these tables and [[relational]] for relation definitions.
