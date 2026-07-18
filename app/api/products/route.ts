import { env } from "cloudflare:workers";

type ProductEnv = { DB: D1Database; PRODUCT_IMAGES: R2Bucket };
const runtime = () => env as unknown as ProductEnv;

async function ensureProductsTable(db: D1Database) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sku TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    model TEXT NOT NULL DEFAULT '',
    style TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT '女包',
    price REAL NOT NULL DEFAULT 0,
    material TEXT NOT NULL DEFAULT '',
    size TEXT NOT NULL DEFAULT '',
    packing_quantity INTEGER NOT NULL DEFAULT 1,
    stock INTEGER NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '',
    image_key TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
}

export async function GET() {
  try {
    const { DB } = runtime();
    await ensureProductsTable(DB);
    const result = await DB.prepare("SELECT * FROM products ORDER BY created_at DESC, id DESC").all();
    return Response.json({ products: result.results });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "商品加载失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { DB, PRODUCT_IMAGES } = runtime();
    await ensureProductsTable(DB);
    const form = await request.formData();
    const value = (key: string) => String(form.get(key) ?? "").trim();
    const sku = value("sku");
    const name = value("name");
    const price = Number(value("price"));
    if (!sku || !name || !Number.isFinite(price) || price < 0) {
      return Response.json({ error: "请填写货号、品名和有效价格" }, { status: 400 });
    }

    const image = form.get("image");
    let imageKey: string | null = null;
    if (image instanceof File && image.size > 0) {
      if (!image.type.startsWith("image/") || image.size > 12 * 1024 * 1024) {
        return Response.json({ error: "图片需小于 12MB，且必须是图片格式" }, { status: 400 });
      }
      const extension = image.name.split(".").pop()?.replace(/[^a-zA-Z0-9]/g, "") || "jpg";
      imageKey = `${crypto.randomUUID()}.${extension}`;
      await PRODUCT_IMAGES.put(imageKey, await image.arrayBuffer(), {
        httpMetadata: { contentType: image.type },
      });
    }

    const statement = DB.prepare(`INSERT INTO products
      (sku, name, model, style, category, price, material, size, packing_quantity, stock, notes, image_key)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        sku,
        name,
        value("model"),
        value("style"),
        value("category") || "女包",
        price,
        value("material"),
        value("size"),
        Math.max(1, Number(value("packingQuantity")) || 1),
        Math.max(0, Number(value("stock")) || 0),
        value("notes"),
        imageKey,
      );
    const result = await statement.run();
    return Response.json({ id: result.meta.last_row_id }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "商品保存失败";
    return Response.json({ error: message.includes("UNIQUE") ? "这个货号已经存在" : message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { DB, PRODUCT_IMAGES } = runtime();
    await ensureProductsTable(DB);
    const id = Number(new URL(request.url).searchParams.get("id"));
    if (!Number.isInteger(id) || id < 1) return Response.json({ error: "无效商品" }, { status: 400 });
    const product = await DB.prepare("SELECT image_key FROM products WHERE id = ?").bind(id).first<{ image_key: string | null }>();
    if (product?.image_key) await PRODUCT_IMAGES.delete(product.image_key);
    await DB.prepare("DELETE FROM products WHERE id = ?").bind(id).run();
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "删除失败" }, { status: 500 });
  }
}
