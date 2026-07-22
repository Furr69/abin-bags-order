import { env } from "cloudflare:workers";

type ProductEnv = { DB: D1Database; PRODUCT_IMAGES: R2Bucket; ADMIN_EMAIL?: string };
const runtime = () => env as unknown as ProductEnv;
const packOptions = [50, 60, 70, 80, 90, 100];

function isAdmin(request: Request) {
  const adminEmail = String(runtime().ADMIN_EMAIL ?? "").toLowerCase();
  const userEmail = String(request.headers.get("oai-authenticated-user-email") ?? "").toLowerCase();
  return Boolean(adminEmail && userEmail && adminEmail === userEmail);
}

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
    packing_quantity INTEGER NOT NULL DEFAULT 100,
    carton_volume REAL NOT NULL DEFAULT 0,
    stock INTEGER NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '',
    image_key TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
  const columns = await db.prepare("PRAGMA table_info(products)").all<{ name: string }>();
  if (!columns.results.some((column) => column.name === "carton_volume")) {
    await db.prepare("ALTER TABLE products ADD COLUMN carton_volume REAL NOT NULL DEFAULT 0").run();
  }
}

export async function GET(request: Request) {
  if (!isAdmin(request)) return Response.json({ error: "没有管理权限" }, { status: 403 });
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
  if (!isAdmin(request)) return Response.json({ error: "没有管理权限" }, { status: 403 });
  try {
    const { DB, PRODUCT_IMAGES } = runtime();
    await ensureProductsTable(DB);
    const form = await request.formData();
    const value = (key: string) => String(form.get(key) ?? "").trim();
    const image = form.get("image");
    if (!(image instanceof File) || image.size === 0) {
      return Response.json({ error: "请选择一张商品图片" }, { status: 400 });
    }
    const imageLabel = image.name.replace(/\.[^.]+$/, "").trim();
    const sku = value("sku") || `IMG-${Date.now().toString(36).toUpperCase()}`;
    const name = value("name") || imageLabel || "商品图片";
    const priceText = value("price");
    const price = priceText === "" ? 0 : Number(priceText);
    const packingQuantity = Number(value("packingQuantity"));
    if (!Number.isFinite(price) || price < 0) {
      return Response.json({ error: "价格需要是有效的非负数，也可以留空" }, { status: 400 });
    }
    if (!packOptions.includes(packingQuantity)) {
      return Response.json({ error: "每箱数量只能选择 50、60、70、80、90 或 100" }, { status: 400 });
    }

    let imageKey: string | null = null;
    if (image instanceof File && image.size > 0) {
      if (!image.type.startsWith("image/") || image.size > 12 * 1024 * 1024) {
        return Response.json({ error: "图片需小于 12MB，且必须是图片格式" }, { status: 400 });
      }
      const extension = image.name.split(".").pop()?.replace(/[^a-zA-Z0-9]/g, "") || "jpg";
      imageKey = `${crypto.randomUUID()}.${extension}`;
      await PRODUCT_IMAGES.put(imageKey, await image.arrayBuffer(), { httpMetadata: { contentType: image.type } });
    }

    const result = await DB.prepare(`INSERT INTO products
      (sku, name, model, style, category, price, material, size, packing_quantity, carton_volume, stock, notes, image_key)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        sku, name, value("model"), value("style"), value("category") || "女包", price,
        value("material"), value("size"), packingQuantity,
        Math.max(0, Number(value("cartonVolume")) || 0),
        Math.max(0, Number(value("stock")) || 0), value("notes"), imageKey,
      ).run();
    return Response.json({ id: result.meta.last_row_id }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "商品保存失败";
    return Response.json({ error: message.includes("UNIQUE") ? "这个货号已经存在" : message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  if (!isAdmin(request)) return Response.json({ error: "没有管理权限" }, { status: 403 });
  const { DB, PRODUCT_IMAGES } = runtime();
  let uploadedImageKey: string | null = null;
  try {
    await ensureProductsTable(DB);
    const form = await request.formData();
    const value = (key: string) => String(form.get(key) ?? "").trim();
    const id = Number(value("id"));
    const sku = value("sku");
    const name = value("name");
    const priceText = value("price");
    const price = priceText === "" ? 0 : Number(priceText);
    const packingQuantity = Number(value("packingQuantity"));
    if (!Number.isInteger(id) || id < 1) {
      return Response.json({ error: "商品无效" }, { status: 400 });
    }
    if (!sku || !name || !Number.isFinite(price) || price < 0) {
      return Response.json({ error: "请填写货号和品名；价格可留空" }, { status: 400 });
    }
    if (!packOptions.includes(packingQuantity)) {
      return Response.json({ error: "每箱数量只能选择 50、60、70、80、90 或 100" }, { status: 400 });
    }

    const current = await DB.prepare("SELECT image_key FROM products WHERE id = ?").bind(id).first<{ image_key: string | null }>();
    if (!current) return Response.json({ error: "找不到这个商品" }, { status: 404 });

    const image = form.get("image");
    if (image instanceof File && image.size > 0) {
      if (!image.type.startsWith("image/") || image.size > 12 * 1024 * 1024) {
        return Response.json({ error: "图片需小于 12MB，且必须是图片格式" }, { status: 400 });
      }
      const extension = image.name.split(".").pop()?.replace(/[^a-zA-Z0-9]/g, "") || "jpg";
      uploadedImageKey = `${crypto.randomUUID()}.${extension}`;
      await PRODUCT_IMAGES.put(uploadedImageKey, await image.arrayBuffer(), { httpMetadata: { contentType: image.type } });
    }

    await DB.prepare(`UPDATE products SET
      sku = ?, name = ?, model = ?, style = ?, category = ?, price = ?, material = ?, size = ?,
      packing_quantity = ?, carton_volume = ?, stock = ?, notes = ?, image_key = ?
      WHERE id = ?`)
      .bind(
        sku, name, value("model"), value("style"), value("category") || "女包", price,
        value("material"), value("size"), packingQuantity,
        Math.max(0, Number(value("cartonVolume")) || 0),
        Math.max(0, Number(value("stock")) || 0), value("notes"),
        uploadedImageKey || current.image_key, id,
      ).run();
    if (uploadedImageKey && current.image_key) await PRODUCT_IMAGES.delete(current.image_key).catch(() => undefined);
    return Response.json({ ok: true });
  } catch (error) {
    if (uploadedImageKey) await PRODUCT_IMAGES.delete(uploadedImageKey).catch(() => undefined);
    const message = error instanceof Error ? error.message : "修改失败";
    return Response.json({ error: message.includes("UNIQUE") ? "这个货号已经存在" : message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  if (!isAdmin(request)) return Response.json({ error: "没有管理权限" }, { status: 403 });
  try {
    const { DB } = runtime();
    await ensureProductsTable(DB);
    const payload = await request.json() as { id?: unknown; price?: unknown };
    const id = Number(payload.id);
    const priceText = String(payload.price ?? "").trim();
    const price = priceText === "" ? 0 : Number(priceText);
    if (!Number.isInteger(id) || id < 1) return Response.json({ error: "商品无效" }, { status: 400 });
    if (!Number.isFinite(price) || price < 0) return Response.json({ error: "价格需要是有效的非负数，也可以留空" }, { status: 400 });
    const result = await DB.prepare("UPDATE products SET price = ? WHERE id = ?").bind(price, id).run();
    if (!result.meta.changes) return Response.json({ error: "找不到这个商品" }, { status: 404 });
    return Response.json({ ok: true, price });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "价格保存失败" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  if (!isAdmin(request)) return Response.json({ error: "没有管理权限" }, { status: 403 });
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
