import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { auth } from "./auth";
import { keyHash, KOSYNC_PATH } from "./kosync";

const http = httpRouter();
auth.addHttpRoutes(http);

// KOReader sync API, for e-readers (CrossPoint on the Xteink, or KOReader itself).
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/vnd.koreader.v1+json" } });

const kosync = httpAction(async (ctx, req) => {
  const path = new URL(req.url).pathname.slice(KOSYNC_PATH.length).replace(/\/+$/, "");

  // Accounts are made in Ribbon (Library → E-reader sync), not by devices.
  if (path === "/users/create") return json(402, { message: "Make the password in Ribbon: Library → E-reader sync" });

  const username = req.headers.get("x-auth-user") ?? "";
  const key = req.headers.get("x-auth-key") ?? "";
  const userId = username && key ? await ctx.runQuery(internal.kosync.authorize, { username, keyHash: await keyHash(key) }) : null;
  if (!userId) return json(401, { message: "Unauthorized" });

  if (path === "/users/auth" && req.method === "GET") return json(200, { authorized: "OK" });

  const get = path.match(/^\/syncs\/progress\/([0-9a-fA-F]{32})$/);
  if (get && req.method === "GET") {
    const p = await ctx.runQuery(internal.kosync.getProgress, { userId, document: get[1].toLowerCase() });
    // CrossPoint takes 404 as "nothing synced yet".
    if (!p) return json(404, { message: "No progress for this book" });
    return json(200, {
      document: get[1],
      progress: p.xpointer ?? "", // empty: the device falls back to the percentage
      percentage: p.fraction,
      device: p.deviceName,
      device_id: p.device,
      timestamp: Math.floor(p.updatedAt / 1000),
    });
  }

  if (path === "/syncs/progress" && req.method === "PUT") {
    let body: { document?: unknown; progress?: unknown; percentage?: unknown; device?: unknown; device_id?: unknown };
    try {
      body = await req.json();
    } catch {
      return json(400, { message: "Expected JSON" });
    }
    const document = typeof body.document === "string" ? body.document.toLowerCase() : "";
    const percentage = Number(body.percentage);
    if (!/^[0-9a-f]{32}$/.test(document) || typeof body.progress !== "string" || !isFinite(percentage)) {
      return json(400, { message: "Expected document, progress and percentage" });
    }
    const device = typeof body.device === "string" && body.device ? body.device : "E-reader";
    await ctx.runMutation(internal.kosync.putProgress, {
      userId,
      document,
      xpointer: body.progress,
      fraction: percentage,
      device: `kosync:${typeof body.device_id === "string" ? body.device_id : device}`,
      deviceName: device === "CrossPoint" ? "Xteink" : device,
    });
    // A book not in the library is accepted and ignored, so the device doesn't report an error.
    return json(200, { document, timestamp: Math.floor(Date.now() / 1000) });
  }

  return json(404, { message: "Not found" });
});

for (const method of ["GET", "PUT", "POST"] as const) http.route({ pathPrefix: `${KOSYNC_PATH}/`, method, handler: kosync });

export default http;
