import { env } from "cloudflare:workers";

export async function GET(request: Request) {
  const runtime = env as unknown as { DB: D1Database; PRODUCT_IMAGES: R2Bucket; MIGRATION_EXPORT_TOKEN_HASH?: string; MIGRATION_EXPORT_EXPIRES?: string };
  const token = request.headers.get("x-migration-export-token") || "";
  const expires = Number(runtime.MIGRATION_EXPORT_EXPIRES || 0);
  if (!token || !runtime.MIGRATION_EXPORT_TOKEN_HASH || Date.now() > expires) return new Response("Forbidden", { status: 403 });
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)))).map(value => value.toString(16).padStart(2, "0")).join("");
  if (hash !== runtime.MIGRATION_EXPORT_TOKEN_HASH) return new Response("Forbidden", { status: 403 });
  const key = new URL(request.url).searchParams.get("image");
  if (key) {
    const product = await runtime.DB.prepare("SELECT id FROM products WHERE image_key = ? LIMIT 1").bind(key).first();
    if (!product) return new Response("Not found", { status: 404 });
    const image = await runtime.PRODUCT_IMAGES.get(key);
    if (!image) return new Response("Not found", { status: 404 });
    const headers = new Headers({ "cache-control": "no-store" });
    image.writeHttpMetadata(headers);
    return new Response(image.body, { headers });
  }
  const products = await runtime.DB.prepare("SELECT * FROM products ORDER BY id").all();
  const settings = await runtime.DB.prepare("SELECT * FROM site_settings ORDER BY id").all();
  return Response.json({ products: products.results, settings_rows: settings.results }, { headers: { "cache-control": "no-store" } });
}
