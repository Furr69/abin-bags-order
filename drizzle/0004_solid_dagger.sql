DROP INDEX `products_sku_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `products_factory_sku_unique` ON `products` (`factory`,`sku`);