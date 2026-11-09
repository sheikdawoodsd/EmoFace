import type { Config } from "@netlify/functions";
import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { history, users } from "../../db/schema.js";
import { EMOTIONS, error, isUuid, photos, toItem } from "../../server/common.js";

const MAX_PHOTO_BYTES = 4 * 1024 * 1024;

/**
 * Saves one analysed photo. The AlexNet model runs in the visitor's browser;
 * this endpoint stores the photo in Blobs and the result in the database.
 */
export default async (req: Request) => {
  if (req.method !== "POST") return error("Method not allowed.", 405);

  const form = await req.formData().catch(() => null);
  if (!form) return error("No photo was sent.");

  const userId = form.get("user_id");
  if (!isUuid(userId)) return error("Your profile was not found. Please sign in again.", 401);
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId));
  if (!user) return error("Your profile was not found. Please sign in again.", 401);

  const image = form.get("image");
  if (!(image instanceof Blob) || image.size === 0) return error("No photo was sent.");
  if (image.size > MAX_PHOTO_BYTES) return error("That photo is too large.", 413);
  const bytes = new Uint8Array(await image.arrayBuffer());
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return error("That file is not a readable image.", 415);

  let result: { emotion?: unknown; probabilities?: Record<string, unknown> };
  try {
    result = JSON.parse(String(form.get("result") ?? ""));
  } catch {
    return error("The analysis result is missing.");
  }
  const probs: Record<string, number> = {};
  for (const e of EMOTIONS) {
    const p = Number(result.probabilities?.[e]);
    if (!Number.isFinite(p) || p < 0 || p > 1) return error("The analysis result is not valid.");
    probs[e] = p;
  }
  const emotion = EMOTIONS.reduce((best, e) => (probs[e] > probs[best] ? e : best), EMOTIONS[0]);

  const imageKey = `${crypto.randomUUID().replace(/-/g, "")}.jpg`;
  await photos().set(imageKey, bytes.buffer as ArrayBuffer);
  try {
    const [row] = await db
      .insert(history)
      .values({ userId, emotion, confidence: probs[emotion], probabilities: probs, imageKey })
      .returning();
    return Response.json({ history_item: toItem(row) }, { status: 201 });
  } catch (err) {
    await photos().delete(imageKey).catch(() => undefined);
    throw err;
  }
};

export const config: Config = {
  path: "/api/analyze",
};
