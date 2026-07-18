import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ExcelJS from "exceljs";

test("ships carton ordering, product management, and PA-template export", async () => {
  const [catalog, api, settingsApi, managePage, hosting] = await Promise.all([
    readFile(new URL("../app/CatalogApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/products/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/settings/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/manage/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
  ]);
  assert.match(catalog, /const packOptions = \[50, 60, 70, 80, 90, 100\]/);
  assert.match(catalog, /order-template\.xlsx/);
  assert.match(catalog, /workbook\.addImage/);
  assert.match(catalog, /保存修改/);
  assert.match(catalog, /删除商品/);
  assert.match(catalog, /待上传商品预览/);
  assert.match(catalog, /照片已选择，填写资料后点击保存/);
  assert.match(api, /export async function PUT/);
  assert.match(api, /export async function DELETE/);
  assert.match(api, /oai-authenticated-user-email/);
  assert.match(settingsApi, /export async function PUT/);
  assert.match(catalog, /页面设置/);
  assert.match(managePage, /requireChatGPTUser\("\/manage"\)/);
  assert.match(hosting, /"d1": "DB"/);
  assert.match(hosting, /"r2": "PRODUCT_IMAGES"/);
});

test("the published Excel template keeps the required PA structure, borders, and images", async () => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(new URL("../public/order-template.xlsx", import.meta.url));
  const sheet = workbook.getWorksheet("Sheet1");
  assert.ok(sheet);
  assert.equal(sheet.getCell("C1").text, "装箱单");
  assert.equal(sheet.getCell("C4").text, "图片");
  assert.equal(sheet.getCell("I4").text, "件数");
  assert.equal(sheet.getCell("J4").text, "装箱数");
  assert.equal(sheet.getImages().length, 8);
  for (let column = 2; column <= 17; column++) {
    const border = sheet.getRow(5).getCell(column).border;
    assert.equal(border.top?.style, "thin");
    assert.equal(border.bottom?.style, "thin");
  }
});
