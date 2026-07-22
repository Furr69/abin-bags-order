import { env } from "cloudflare:workers";

type SettingsEnv = { DB: D1Database; ADMIN_EMAIL?: string };

const defaults = {
  brandName: "阿斌皮具",
  brandSubtitle: "线上选品 · 按箱订货",
  heroEyebrow: "ABIN LEATHER GOODS",
  heroTitle: "选好款式，\n按箱快速订货。",
  heroDescription: "填写箱数，选择每箱数量，系统自动计算总数量和金额。",
  accent: "#df664e",
  accentDark: "#b94634",
  columns: 3,
};

const runtime = () => env as unknown as SettingsEnv;

async function ensureSettingsTable(db: D1Database) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS site_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    brand_name TEXT NOT NULL DEFAULT '阿斌皮具',
    brand_subtitle TEXT NOT NULL DEFAULT '线上选品 · 按箱订货',
    hero_eyebrow TEXT NOT NULL DEFAULT 'ABIN LEATHER GOODS',
    hero_title TEXT NOT NULL DEFAULT '选好款式，按箱快速订货。',
    hero_description TEXT NOT NULL DEFAULT '填写箱数，选择每箱数量，系统自动计算总数量和金额。',
    accent TEXT NOT NULL DEFAULT '#df664e',
    accent_dark TEXT NOT NULL DEFAULT '#b94634',
    columns INTEGER NOT NULL DEFAULT 3,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
}

function isAdmin(request: Request) {
  const adminEmail = String(runtime().ADMIN_EMAIL ?? "").toLowerCase();
  const userEmail = String(request.headers.get("oai-authenticated-user-email") ?? "").toLowerCase();
  return Boolean(adminEmail && userEmail && adminEmail === userEmail);
}

export async function GET(request: Request) {
  if (!isAdmin(request)) return Response.json({ error: "没有管理权限" }, { status: 403 });
  try {
    const { DB } = runtime();
    await ensureSettingsTable(DB);
    const row = await DB.prepare("SELECT * FROM site_settings WHERE id = 1").first<Record<string, unknown>>();
    if (!row) return Response.json({ settings: defaults });
    return Response.json({
      settings: {
        brandName: row.brand_name,
        brandSubtitle: row.brand_subtitle,
        heroEyebrow: row.hero_eyebrow,
        heroTitle: row.hero_title,
        heroDescription: row.hero_description,
        accent: row.accent,
        accentDark: row.accent_dark,
        columns: row.columns,
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "页面设置加载失败" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  if (!isAdmin(request)) return Response.json({ error: "没有管理权限" }, { status: 403 });
  try {
    const { DB } = runtime();
    await ensureSettingsTable(DB);
    const payload = await request.json() as Partial<typeof defaults>;
    const text = (value: unknown, fallback: string, max: number) => String(value ?? fallback).trim().slice(0, max) || fallback;
    const color = (value: unknown, fallback: string) => /^#[0-9a-fA-F]{6}$/.test(String(value)) ? String(value) : fallback;
    const columns = [2, 3, 4].includes(Number(payload.columns)) ? Number(payload.columns) : 3;
    const values = {
      brandName: text(payload.brandName, defaults.brandName, 40),
      brandSubtitle: text(payload.brandSubtitle, defaults.brandSubtitle, 80),
      heroEyebrow: text(payload.heroEyebrow, defaults.heroEyebrow, 80),
      heroTitle: text(payload.heroTitle, defaults.heroTitle, 100),
      heroDescription: text(payload.heroDescription, defaults.heroDescription, 180),
      accent: color(payload.accent, defaults.accent),
      accentDark: color(payload.accentDark, defaults.accentDark),
      columns,
    };
    await DB.prepare(`INSERT INTO site_settings
      (id, brand_name, brand_subtitle, hero_eyebrow, hero_title, hero_description, accent, accent_dark, columns, updated_at)
      VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        brand_name=excluded.brand_name, brand_subtitle=excluded.brand_subtitle,
        hero_eyebrow=excluded.hero_eyebrow, hero_title=excluded.hero_title,
        hero_description=excluded.hero_description, accent=excluded.accent,
        accent_dark=excluded.accent_dark, columns=excluded.columns, updated_at=CURRENT_TIMESTAMP`)
      .bind(values.brandName, values.brandSubtitle, values.heroEyebrow, values.heroTitle, values.heroDescription, values.accent, values.accentDark, values.columns)
      .run();
    return Response.json({ settings: values });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "页面设置保存失败" }, { status: 500 });
  }
}
