import { sql } from "drizzle-orm";
import { integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const products = sqliteTable("products", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sku: text("sku").notNull(),
  name: text("name").notNull(),
  model: text("model").notNull().default(""),
  style: text("style").notNull().default(""),
  category: text("category").notNull().default("女包"),
  factory: text("factory").notNull().default(""),
  price: real("price").notNull().default(0),
  material: text("material").notNull().default(""),
  size: text("size").notNull().default(""),
  packingQuantity: integer("packing_quantity").notNull().default(1),
  cartonVolume: real("carton_volume").notNull().default(0),
  stock: integer("stock").notNull().default(0),
  notes: text("notes").notNull().default(""),
  imageKey: text("image_key"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("products_factory_sku_unique").on(table.factory, table.sku),
]);

export const siteSettings = sqliteTable("site_settings", {
  id: integer("id").primaryKey(),
  brandName: text("brand_name").notNull().default("阿斌皮具"),
  brandSubtitle: text("brand_subtitle").notNull().default("线上选品 · 按箱订货"),
  heroEyebrow: text("hero_eyebrow").notNull().default("ABIN LEATHER GOODS"),
  heroTitle: text("hero_title").notNull().default("选好款式，按箱快速订货。"),
  heroDescription: text("hero_description").notNull().default("填写箱数，选择每箱数量，系统自动计算总数量和金额。"),
  accent: text("accent").notNull().default("#df664e"),
  accentDark: text("accent_dark").notNull().default("#b94634"),
  columns: integer("columns").notNull().default(3),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
