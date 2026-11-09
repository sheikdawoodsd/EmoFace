import { getStore } from "@netlify/blobs";
import type { history } from "../db/schema.js";

export const GENDERS = ["Female", "Male", "Non-binary", "Prefer not to say"];
export const EMOTIONS = ["angry", "disgust", "fear", "happy", "neutral", "sad", "surprise"];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

export const error = (message: string, status = 400) => Response.json({ error: message }, { status });

export const photos = () => getStore("captures");

export async function removePhotos(keys: string[]) {
  const store = photos();
  await Promise.all(keys.map((k) => store.delete(k).catch(() => undefined)));
}

type HistoryRow = typeof history.$inferSelect;

/** Shape the front end expects for one saved detection. */
export const toItem = (row: HistoryRow) => ({
  id: row.id,
  user_id: row.userId,
  emotion: row.emotion,
  confidence: row.confidence,
  probabilities: row.probabilities,
  created_at: row.createdAt.toISOString(),
  image_url: `/api/photos/${row.imageKey}`,
});

export const toUser = (u: { id: string; name: string; age: number; gender: string; createdAt: Date }) => ({
  id: u.id,
  name: u.name,
  age: u.age,
  gender: u.gender,
  created_at: u.createdAt.toISOString(),
});
