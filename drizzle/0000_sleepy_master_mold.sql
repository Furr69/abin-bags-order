CREATE TABLE `products` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sku` text NOT NULL,
	`name` text NOT NULL,
	`model` text DEFAULT '' NOT NULL,
	`style` text DEFAULT '' NOT NULL,
	`category` text DEFAULT '女包' NOT NULL,
	`price` real DEFAULT 0 NOT NULL,
	`material` text DEFAULT '' NOT NULL,
	`size` text DEFAULT '' NOT NULL,
	`packing_quantity` integer DEFAULT 1 NOT NULL,
	`stock` integer DEFAULT 0 NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`image_key` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `products_sku_unique` ON `products` (`sku`);