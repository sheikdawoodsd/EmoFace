import type { Config, Context } from "@netlify/functions";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { history, users } from "../../db/schema.js";
import { error, isUuid, removePhotos, toItem } from "../../server/common.js";

export default async (req: Request, context: Context) => {
  const userId = new URL(req.url).searchParams.get("user_id");
  if (!isUuid(userId)) return error("Your profile was not found.", 401);
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId));
  if (!user) return error("Your profile was not found.", 401);

  const itemId = context.params.id;

  if (req.method === "GET" && !itemId) {
    const rows = await db.select().from(history).where(eq(history.userId, userId)).orderBy(desc(history.id));
    return Response.json(rows.map(toItem));
  }

  if (req.method === "DELETE") {
    let where = eq(history.userId, userId);
    if (itemId) {
      if (!/^\d+$/.test(itemId)) return new Response(null, { status: 204 });
      where = and(where, eq(history.id, Number(itemId)))!;
    }
    const removed = await db.delete(history).where(where).returning({ key: history.imageKey });
    await removePhotos(removed.map((r) => r.key));
    return new Response(null, { status: 204 });
  }

  return error("Method not allowed.", 405);
};

export const config: Config = {
  path: ["/api/history", "/api/history/:id"],
};
