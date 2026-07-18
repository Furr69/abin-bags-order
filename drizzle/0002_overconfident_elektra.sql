CREATE TABLE `site_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`brand_name` text DEFAULT '阿斌皮具' NOT NULL,
	`brand_subtitle` text DEFAULT '线上选品 · 按箱订货' NOT NULL,
	`hero_eyebrow` text DEFAULT 'ABIN LEATHER GOODS' NOT NULL,
	`hero_title` text DEFAULT '选好款式，按箱快速订货。' NOT NULL,
	`hero_description` text DEFAULT '填写箱数，选择每箱数量，系统自动计算总数量和金额。' NOT NULL,
	`accent` text DEFAULT '#df664e' NOT NULL,
	`accent_dark` text DEFAULT '#b94634' NOT NULL,
	`columns` integer DEFAULT 3 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
