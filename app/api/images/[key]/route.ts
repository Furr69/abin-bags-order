import { env } from "cloudflare:workers";

export async function GET(request: Request, context: { params: Promise<{ key: string }> }) {
  const runtime = env as unknown as { PRODUCT_IMAGES: R2Bucket; ADMIN_EMAIL?: string };
  const adminEmail = String(runtime.ADMIN_EMAIL ?? "").toLowerCase();
  const userEmail = String(request.headers.get("oai-authenticated-user-email") ?? "").toLowerCase();
  if (!adminEmail || userEmail !== adminEmail) return new Response("Forbidden", { status: 403 });
  const { key } = await context.params;
  const bucket = runtime.PRODUCT_IMAGES;
  const object = await bucket.get(key);
  if (!object) return new Response("Not found", { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "private, max-age=31536000, immutable");
  return new Response(object.body, { headers });
}
