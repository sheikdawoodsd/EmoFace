import { doublePrecision, index, integer, jsonb, pgTable, serial, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  age: integer().notNull(),
  gender: text().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const history = pgTable(
  "history",
  {
    id: serial().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    emotion: text().notNull(),
    confidence: doublePrecision().notNull(),
    probabilities: jsonb().$type<Record<string, number>>().notNull(),
    imageKey: text("image_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("history_user_idx").on(t.userId, t.id)],
);
