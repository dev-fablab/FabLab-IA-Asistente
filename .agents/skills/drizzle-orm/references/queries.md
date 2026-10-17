---
description: "SQL-like query API: select, insert, update, delete, filters, joins, aggregations. Read for data access patterns."
connections: [schema, relational]
---

# Queries (SQL-like API)

Import operators from `drizzle-orm`: `eq`, `ne`, `gt`, `lt`, `gte`, `lte`, `and`, `or`, `not`, `sql`, `desc`, `asc`, `count`, etc.

## Select

```ts
import { eq, and, desc, sql } from "drizzle-orm";

// Full
const all = await db.select().from(users);

// Partial
const names = await db.select({ id: users.id, name: users.name }).from(users);

// Where
const user = await db.select().from(users).where(eq(users.id, 1));
const filtered = await db.select().from(users).where(
  and(eq(users.isActive, true), gt(users.age, 18))
);

// Order, limit, offset
const recent = await db.select().from(users).orderBy(desc(users.createdAt)).limit(10).offset(20);

// Distinct
await db.selectDistinct().from(users);

// Aggregations
const stats = await db.select({
  count: count(),
  avgAge: avg(users.age),
}).from(users).groupBy(users.isActive);

// Custom SQL
const lower = await db.select({
  name: sql<string>`lower(${users.name})`,
}).from(users).where(sql`lower(${users.name}) like ${'%dan%'}`);
```

## Insert

```ts
await db.insert(users).values({ name: "Andrew", email: "a@example.com" });

await db.insert(users).values([
  { name: "Dan", email: "d@example.com" },
  { name: "Alex", email: "al@example.com" },
]);

const inserted = await db.insert(users).values({ name: "New" }).returning();

// Upsert
await db.insert(users).values({ id: 1, name: "Updated" }).onConflictDoUpdate({
  target: users.id,
  set: { name: sql`excluded.name` },
});
```

## Update

```ts
await db.update(users)
  .set({ name: "New Name", updatedAt: new Date() })
  .where(eq(users.id, 1));

const updated = await db.update(users)
  .set({ isActive: false })
  .where(eq(users.id, 1))
  .returning();
```

## Delete

```ts
await db.delete(users).where(eq(users.id, 1));
const deleted = await db.delete(users).where(lt(users.createdAt, someDate)).returning();
```

## Joins

```ts
await db.select()
  .from(users)
  .leftJoin(posts, eq(users.id, posts.authorId))
  .where(eq(users.id, 1));
```

## Transactions

```ts
await db.transaction(async (tx) => {
  await tx.insert(users).values({ ... });
  await tx.insert(posts).values({ ... });
});
```

## Dynamic Queries

Build conditionally:

```ts
let query = db.select().from(users);
if (filter) query = query.where(eq(users.name, filter));
const result = await query;
```

See [[schema]] for table definitions and [[relational]] for the alternative Relational Queries API.
