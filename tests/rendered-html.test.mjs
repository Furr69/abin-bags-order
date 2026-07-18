import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("ships the Chinese handbag ordering experience", async () => {
  const [catalog, layout, hosting] = await Promise.all([
    readFile(new URL("../app/CatalogApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
  ]);
  assert.match(catalog, /阿斌皮具/);
  assert.match(catalog, /下载 Excel 订货单/);
  assert.match(catalog, /商品管理/);
  assert.match(layout, /线上选品与订货/);
  assert.match(hosting, /"d1": "DB"/);
  assert.match(hosting, /"r2": "PRODUCT_IMAGES"/);
  assert.doesNotMatch(catalog + layout, /codex-preview|SkeletonPreview/);
});
