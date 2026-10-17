---
description: "Relational Queries API (db.query) with defineRelations and with clauses for nested data. Read when fetching related records."
connections: [schema, queries]
---

# Relational Queries API

Alternative to manual joins. Requires defining relations and passing them when initializing the db client.

## Defining Relations

```ts
import { relations } from "drizzle-orm"; // or defineRelations in newer APIs

export const usersRelations = relations(users, ({ many }) => ({
  posts: many(posts),
}));

export const postsRelations = relations(posts, ({ one }) => ({
  author: one(users, {
    fields: [posts.authorId],
    references: [users.id],
  }),
}));
```

In v1 / newer style (from docs):

```ts
export const relations = defineRelations({ users, posts }, (r) => ({
  users: {
    posts: r.many.posts(),
  },
  posts: {
    author: r.one.users({
      from: r.posts.authorId,
      to: r.users.id,
    }),
  },
}));
```

## Initialize Client

```ts
import * as schema from "./schema";
const db = drizzle(pool, { schema });
// or with explicit relations if required by version
```

## Querying

```ts
const usersWithPosts = await db.query.users.findMany({
  with: {
    posts: {
      columns: { title: true, id: true },
      with: {
        // nested
      },
    },
  },
  where: (users, { eq }) => eq(users.isActive, true),
  orderBy: (users, { desc }) => [desc(users.createdAt)],
  limit: 10,
});

const user = await db.query.users.findFirst({
  where: (users, { eq }) => eq(users.id, 1),
  with: { posts: true },
});
```

## Differences from SQL-like

- Automatic joins / nested result mapping in one query.
- Callback style for where/orderBy inside relational context: `(table, { eq }) => eq(...)`.
- Better for nested data; SQL-like for complex aggregates or full control.
- Requires relations defined; otherwise falls back or errors.

Upgrade note: Relational Queries v1 → v2 has changes; see official docs/relations-v1-v2.

See [[schema]] for tables and [[queries]] for the SQL-like alternative.
