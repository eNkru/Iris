# Database Operations

This document covers database best practices using Drizzle ORM with PostgreSQL.

## Critical Rules

### 0. FK to better-auth `user.id` must be `text`, NOT `uuid`

better-auth generates user IDs as **32-char alphanumeric strings** (`generateId(32)` → `[A-Za-z0-9]`), and its Drizzle adapter schema declares `user.id` as `text`. Any app table with a foreign key referencing `user.id` MUST declare that column as `text(...)` — declaring it `uuid(...)` makes the FK incompatible and `db:migrate` fails at schema creation:

```
ERROR: foreign key constraint "..." cannot be implemented
DETAIL: Key columns "userId" and "id" are of incompatible types: uuid and text.
```

```typescript
// BAD — uuid FK to a text primary key
userId: uuid("userId").references(() => user.id, { onDelete: "cascade" }),

// GOOD — text FK matching better-auth's text user.id
userId: text("userId").references(() => user.id, { onDelete: "cascade" }),
```

This applies to every table that scopes data to a user (`products.userId`, `alert_channels.userId`, `user_settings.userId`, ...). `session.userId` / `account.userId` already use `text` in the auth schema — mirror that.



### 1. NO `await` in Loops (N+1 Problem)

Never use `await` inside a loop. This creates the N+1 query problem, causing severe performance degradation.

```typescript
// BAD - N+1 queries (1 query per iteration)
const orders = await db.select().from(orderTable).where(eq(orderTable.userId, userId));
for (const order of orders) {
  const items = await db.select().from(orderItemTable).where(eq(orderItemTable.orderId, order.id));
  order.items = items;
}

// GOOD - 2 queries total using inArray
const orders = await db.select().from(orderTable).where(eq(orderTable.userId, userId));
const orderIds = orders.map(o => o.id);

// Single query for all items
const allItems = await db
  .select()
  .from(orderItemTable)
  .where(inArray(orderItemTable.orderId, orderIds));

// Group items by orderId in memory
const itemsByOrder = new Map<string, typeof allItems>();
for (const item of allItems) {
  const existing = itemsByOrder.get(item.orderId) || [];
  existing.push(item);
  itemsByOrder.set(item.orderId, existing);
}

// Attach to orders
const ordersWithItems = orders.map(order => ({
  ...order,
  items: itemsByOrder.get(order.id) || [],
}));
```

### 2. Batch Insert Pattern

Use batch inserts for multiple records instead of individual inserts.

```typescript
// BAD - Multiple insert statements
for (const item of items) {
  await db.insert(orderItemTable).values(item);
}

// GOOD - Single batch insert
await db.insert(orderItemTable).values(items);

// With returning clause
const insertedItems = await db
  .insert(orderItemTable)
  .values(items)
  .returning();
```

### 3. Conflict Handling with `onConflictDoUpdate`

Handle upserts efficiently with conflict resolution.

```typescript
// Upsert single record
await db
  .insert(userSettingsTable)
  .values({
    userId,
    theme: "dark",
    notifications: true,
  })
  .onConflictDoUpdate({
    target: userSettingsTable.userId,
    set: {
      theme: sql`excluded.theme`,
      notifications: sql`excluded.notifications`,
      updatedAt: sql`NOW()`,
    },
  });

// Batch upsert with composite key
const upsertedRecords = await db
  .insert(inventoryTable)
  .values(inventoryData)
  .onConflictDoUpdate({
    target: [inventoryTable.warehouseId, inventoryTable.productId],
    set: {
      quantity: sql`excluded.quantity`,
      updatedAt: sql`NOW()`,
    },
  })
  .returning({
    id: inventoryTable.id,
    productId: inventoryTable.productId,
  });
```

## Query Organization

Database queries should be organized in `packages/database/drizzle/queries/`.

```
packages/database/drizzle/queries/
├── index.ts          # Re-exports all query modules
├── types.ts          # Shared query types
├── users.ts          # User-related queries
├── orders.ts         # Order-related queries
└── products.ts       # Product-related queries
```

**Example: `queries/orders.ts`**

```typescript
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../client";
import { order as orderTable, orderItem as orderItemTable } from "../schema/postgres";

/**
 * Bulk upsert orders with conflict handling
 */
export async function bulkUpsertOrders(
  ordersData: Array<{
    externalId: string;
    customerId: string;
    status: string;
    total: number;
  }>,
) {
  if (ordersData.length === 0) {
    return [];
  }

  const upserted = await db
    .insert(orderTable)
    .values(ordersData)
    .onConflictDoUpdate({
      target: [orderTable.externalId],
      set: {
        status: sql`excluded.status`,
        total: sql`excluded.total`,
        updatedAt: sql`NOW()`,
      },
    })
    .returning({
      id: orderTable.id,
      externalId: orderTable.externalId,
    });

  return upserted;
}

/**
 * Get orders with items for a user
 */
export async function getOrdersWithItems(params: {
  userId: string;
  limit?: number;
}) {
  const { userId, limit = 20 } = params;

  const orders = await db
    .select()
    .from(orderTable)
    .where(eq(orderTable.userId, userId))
    .orderBy(desc(orderTable.createdAt))
    .limit(limit);

  if (orders.length === 0) {
    return [];
  }

  const orderIds = orders.map(o => o.id);
  const items = await db
    .select()
    .from(orderItemTable)
    .where(inArray(orderItemTable.orderId, orderIds));

  const itemsByOrder = groupBy(items, "orderId");

  return orders.map(order => ({
    ...order,
    items: itemsByOrder.get(order.id) || [],
  }));
}
```

## Advanced SQL Patterns

### JSON Column Operations

When using PostgreSQL JSON/JSONB columns, proper casting is required for JSON functions.

```typescript
// BAD - Missing cast for jsonb functions
const result = await db
  .select()
  .from(productTable)
  .where(sql`${productTable.metadata}->>'category' = 'electronics'`);

// GOOD - Explicit cast for jsonb operations
const result = await db
  .select()
  .from(productTable)
  .where(sql`${productTable.metadata}::jsonb->>'category' = 'electronics'`);

// JSON array contains check
const withTag = await db
  .select()
  .from(productTable)
  .where(sql`${productTable.tags}::jsonb ? 'featured'`);

// JSON array length
const withMultipleTags = await db
  .select()
  .from(productTable)
  .where(sql`jsonb_array_length(${productTable.tags}::jsonb) > 3`);
```

### Raw SQL Column Names (camelCase)

When using raw SQL with Drizzle, column names must use double quotes for camelCase names.

```typescript
// BAD - PostgreSQL will lowercase unquoted identifiers
await db.execute(sql`
  UPDATE order
  SET lastUpdatedAt = NOW()
  WHERE userId = ${userId}
`);

// GOOD - Double quotes preserve camelCase
await db.execute(sql`
  UPDATE "order"
  SET "lastUpdatedAt" = NOW()
  WHERE "userId" = ${userId}
`);

// Complex raw SQL example
await db.execute(sql`
  UPDATE "order" AS o
  SET
    "totalAmount" = sub."calculatedTotal",
    "updatedAt" = NOW()
  FROM (
    SELECT
      "orderId",
      SUM("price" * "quantity") AS "calculatedTotal"
    FROM "orderItem"
    WHERE "orderId" = ANY(${sql.raw(arrayLiteral)})
    GROUP BY "orderId"
  ) AS sub
  WHERE o.id = sub."orderId"
`);
```

### Enum Comparison

When comparing enum columns in raw SQL, cast the column to text.

```typescript
// BAD - Direct enum comparison may fail
await db.execute(sql`
  SELECT * FROM "order"
  WHERE status != 'DRAFT'
`);

// GOOD - Cast enum column to text
await db.execute(sql`
  SELECT * FROM "order"
  WHERE status::text != 'DRAFT'
`);

// In Drizzle query builder (works correctly)
const orders = await db
  .select()
  .from(orderTable)
  .where(ne(orderTable.status, "DRAFT"));
```

### Aggregation with Filtering

Use FILTER clause for conditional aggregation.

```typescript
await db.execute(sql`
  UPDATE "category" AS c
  SET
    "productCount" = sub."count",
    "activeProductCount" = sub."activeCount",
    "updatedAt" = NOW()
  FROM (
    SELECT
      "categoryId",
      COUNT(*)::int AS "count",
      COUNT(*) FILTER (WHERE "status" = 'ACTIVE')::int AS "activeCount"
    FROM "product"
    WHERE "categoryId" = ANY(${sql.raw(categoryIds)})
    GROUP BY "categoryId"
  ) AS sub
  WHERE c.id = sub."categoryId"
`);
```

## Transaction Patterns

### Basic Transaction

```typescript
import { db } from "@your-app/database";

const result = await db.transaction(async (tx) => {
  // All operations use tx instead of db
  const [order] = await tx
    .insert(orderTable)
    .values({ userId, total: 0 })
    .returning();

  await tx.insert(orderItemTable).values(
    items.map(item => ({
      orderId: order.id,
      ...item,
    }))
  );

  // Update order total
  const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  await tx
    .update(orderTable)
    .set({ total })
    .where(eq(orderTable.id, order.id));

  return order;
});
```

### Transaction with Rollback

```typescript
try {
  await db.transaction(async (tx) => {
    await tx.insert(orderTable).values(orderData);

    // This will cause rollback if payment fails
    const paymentResult = await processPayment(orderData.total);
    if (!paymentResult.success) {
      throw new Error("Payment failed");
    }

    await tx.update(orderTable)
      .set({ paymentId: paymentResult.id })
      .where(eq(orderTable.id, orderData.id));
  });
} catch (error) {
  // Transaction automatically rolled back
  logger.error("Order creation failed", { error });
}
```

## Query Performance Tips

### Use Indexes

Ensure your queries use appropriate indexes:

```typescript
// Good for index on (userId, createdAt DESC)
const recentOrders = await db
  .select()
  .from(orderTable)
  .where(eq(orderTable.userId, userId))
  .orderBy(desc(orderTable.createdAt))
  .limit(10);
```

### Select Only Needed Columns

```typescript
// BAD - Selects all columns including large text fields
const orders = await db.select().from(orderTable);

// GOOD - Select only needed columns
const orders = await db
  .select({
    id: orderTable.id,
    status: orderTable.status,
    total: orderTable.total,
  })
  .from(orderTable);
```

### Use Relations for Complex Queries

```typescript
// Using Drizzle relations for nested data
const ordersWithDetails = await db.query.order.findMany({
  where: eq(orderTable.userId, userId),
  with: {
    items: {
      with: {
        product: true,
      },
    },
    customer: {
      columns: {
        id: true,
        name: true,
        email: true,
      },
    },
  },
  orderBy: (orders, { desc }) => desc(orders.createdAt),
  limit: 20,
});
```

## Single-container SQLite contract

The runtime database is `better-sqlite3` at `DATABASE_PATH` (default `./data/iris.db`; Docker `/app/data/iris.db`). The client creates the parent directory, enables `journal_mode = WAL`, and enables `foreign_keys = ON`. SQLite is authoritative for application and better-auth tables; Redis is not required.

- Dates use `integer(name, { mode: "timestamp" })`, storing Unix epoch seconds while returning `Date` objects. SQLite defaults use `sql\`(unixepoch())\``.
- Booleans use `integer(name, { mode: "boolean" })`.
- JSON columns use `text(name, { mode: "json" }).$type<T>()` for automatic serialization and parsing.
- PostgreSQL enums become typed text plus literal SQLite `CHECK` constraints; migration DDL must not contain bound `?` parameters.
- `better-sqlite3` must be externalized from Next's server bundle and declared directly by the runtime web package so pnpm resolves the native addon.

The checked-in initial migration must be generated with `dialect: "sqlite"`, applied successfully to a fresh scratch file, and run idempotently by the container entrypoint.
