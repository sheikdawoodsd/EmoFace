import type { Config, Context } from "@netlify/functions";
import { photos } from "../../server/common.js";

export default async (_req: Request, context: Context) => {
  const key = context.params.key;
  if (!/^[0-9a-f]{32}\.jpg$/.test(key)) return new Response("Not found", { status: 404 });
  const data = await photos().get(key, { type: "arrayBuffer" });
  if (!data) return new Response("Not found", { status: 404 });
  return new Response(data, {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=31536000, immutable" },
  });
};

export const config: Config = {
  path: "/api/photos/:key",
  method: "GET",
};
