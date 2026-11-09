import type { Config, Context } from "@netlify/functions";
import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { history, users } from "../../db/schema.js";
import { GENDERS, error, isUuid, removePhotos, toUser } from "../../server/common.js";

export default async (req: Request, context: Context) => {
  const id = context.params.id;

  if (!id) {
    if (req.method !== "POST") return error("Method not allowed.", 405);
    const data = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const name = String(data.name ?? "").trim();
    const gender = String(data.gender ?? "").trim();
    const age = Number(data.age);
    if (!Number.isInteger(age)) return error("Enter your age as a number.");
    if (name.length < 1 || name.length > 40) return error("Enter your name (up to 40 characters).");
    if (age < 5 || age > 120) return error("Enter an age between 5 and 120.");
    if (!GENDERS.includes(gender)) return error("Choose one of the gender options.");
    const [created] = await db.insert(users).values({ name, age, gender }).returning();
    return Response.json(toUser(created), { status: 201 });
  }

  if (!isUuid(id)) return error("User not found.", 404);

  if (req.method === "GET") {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user ? Response.json(toUser(user)) : error("User not found.", 404);
  }

  if (req.method === "DELETE") {
    const keys = await db.select({ key: history.imageKey }).from(history).where(eq(history.userId, id));
    const deleted = await db.delete(users).where(eq(users.id, id)).returning({ id: users.id });
    if (!deleted.length) return error("User not found.", 404);
    await removePhotos(keys.map((k) => k.key));
    return new Response(null, { status: 204 });
  }

  return error("Method not allowed.", 405);
};

export const config: Config = {
  path: ["/api/users", "/api/users/:id"],
};
