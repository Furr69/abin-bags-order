import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ExcelJS from "exceljs";

test("ships a private photo library with optional prices and full-size downloads", async () => {
  const [catalog, api, imageApi, settingsApi, managePage, homePage, hosting] = await Promise.all([
    readFile(new URL("../app/CatalogApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/products/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/images/[key]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/settings/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/manage/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
  ]);
  assert.match(catalog, /const packOptions = \[50, 60, 70, 80, 90, 100\]/);
  assert.match(catalog, /order-template\.xlsx/);
  assert.match(catalog, /workbook\.addImage/);
  assert.match(catalog, /编辑全部信息\/更换照片/);
  assert.match(catalog, /保存全部修改/);
  assert.match(catalog, /删除商品/);
  assert.match(catalog, /待上传商品预览/);
  assert.match(catalog, /照片已选择，可直接点击保存/);
  assert.match(catalog, /单价（选填）/);
  assert.match(catalog, /name="image" required/);
  assert.match(catalog, /className="lightbox"/);
  assert.match(catalog, /保存到电脑/);
  assert.match(catalog, /imageInputRef\.current\?\.click\(\)/);
  assert.match(catalog, /imageToExcelDataUrl/);
  assert.match(catalog, /canvas\.width = 900/);
  assert.match(catalog, /row\.height = 170/);
  assert.match(catalog, /ext: \{ width: 128, height: 218 \}/);
  assert.match(api, /export async function GET\(request: Request\)/);
  assert.match(api, /priceText === "" \? 0/);
  assert.match(api, /请选择一张商品图片/);
  assert.match(api, /export async function PUT/);
  assert.match(api, /await request\.formData\(\)/);
  assert.match(api, /uploadedImageKey \|\| current\.image_key/);
  assert.match(api, /export async function DELETE/);
  assert.match(api, /oai-authenticated-user-email/);
  assert.match(imageApi, /oai-authenticated-user-email/);
  assert.match(imageApi, /cache-control", "private/);
  assert.match(settingsApi, /export async function PUT/);
  assert.match(catalog, /页面设置/);
  assert.match(managePage, /requireChatGPTUser\("\/manage"\)/);
  assert.match(homePage, /redirect\("\/manage"\)/);
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
