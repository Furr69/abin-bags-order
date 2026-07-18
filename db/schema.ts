import { sql } from "drizzle-orm";
import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const products = sqliteTable("products", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sku: text("sku").notNull().unique(),
  name: text("name").notNull(),
  model: text("model").notNull().default(""),
  style: text("style").notNull().default(""),
  category: text("category").notNull().default("女包"),
  price: real("price").notNull().default(0),
  material: text("material").notNull().default(""),
  size: text("size").notNull().default(""),
  packingQuantity: integer("packing_quantity").notNull().default(1),
  cartonVolume: real("carton_volume").notNull().default(0),
  stock: integer("stock").notNull().default(0),
  notes: text("notes").notNull().default(""),
  imageKey: text("image_key"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
