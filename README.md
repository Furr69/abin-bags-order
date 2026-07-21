# 阿斌皮具商品管理与选品网站

这是阿斌皮具自用的箱包商品资料网站，主要用于在电脑或手机上上传、查找和维护商品，并按指定的 PA 模板生成包含商品图片和框线的 Excel 订货单。

线上地址：<https://abin-bags-order.furr1r.chatgpt.site/>

## 当前功能

- 商品资料：货号、品名、型号、款式、分类、价格、材质、尺寸、每箱数量、单箱体积、库存、备注和图片。
- 商品管理：新增、编辑全部资料、更换图片、删除商品。
- 查询选品：按关键词搜索，并按箱包分类筛选。
- 装箱数量：填写箱数；每箱数量只能选择 50、60、70、80、90、100。
- 自动计算：款式数、箱数、总件数、金额和总体积。
- Excel 导出：严格读取 `public/order-template.xlsx`，保留模板表头、列宽、框线和说明，并把商品图片写入图片列。
- 页面设置：可调整品牌文字、首页说明、主题颜色和商品列数。
- 管理权限：`/manage` 需要当前登录邮箱与部署环境中的 `ADMIN_EMAIL` 一致。

## 数据存放位置

- 商品文字资料和页面设置：Sites D1，绑定名为 `DB`。
- 商品图片：Sites R2，绑定名为 `PRODUCT_IMAGES`。
- Excel 模板：仓库中的 `public/order-template.xlsx`。
- 数据库结构与迁移：`db/schema.ts` 和 `drizzle/`。

重要：GitHub 保存源代码和 Excel 模板，但线上已经上传的商品记录和图片仍保存在 D1/R2 中，不会随 `git clone` 下载到新电脑。

## 新电脑继续开发

1. 登录 GitHub 账号 `Furr69`，克隆私有仓库：

   ```powershell
   git clone https://github.com/Furr69/abin-bags-order.git D:\CodexProjects\abin-bags-order
   ```

2. 用 Codex 打开 `D:\CodexProjects\abin-bags-order`。
3. 让 Codex 先阅读本 README、`.openai/hosting.json`、`app/CatalogApp.tsx` 和 `app/api/`。
4. 安装依赖并验证：

   ```powershell
   npm install
   npm test
   ```

5. 继续使用同一个 OpenAI/Sites 项目进行部署。`.openai/hosting.json` 中记录了项目 ID 和 D1/R2 绑定。

## 给新 Codex 的开场提示

可以直接发送下面这句话，无需粘贴旧聊天：

> 请先完整阅读 README.md，并检查当前 Git 状态、最近提交和项目代码。这是阿斌皮具商品管理网站。请在现有功能和数据结构上继续，不要重新创建项目，也不要删除线上 D1/R2 数据。所有项目文件继续放在 D:\CodexProjects\abin-bags-order。

## 开发命令

需要 Node.js `>=22.13.0`。

```powershell
npm install
npm run dev
npm run build
npm test
npm run lint
```

## 关键文件

- `app/CatalogApp.tsx`：商品展示、管理、订货和 Excel 导出主界面。
- `app/api/products/route.ts`：商品新增、读取、编辑、删除以及 R2 图片写入。
- `app/api/settings/route.ts`：页面外观设置。
- `app/api/images/[key]/route.ts`：读取 R2 商品图片。
- `app/manage/page.tsx`：管理员入口和权限检查。
- `public/order-template.xlsx`：PA Excel 导出模板。
- `.openai/hosting.json`：Sites 项目及 D1/R2 绑定。

## 交接原则

- 不需要把全部 Codex 聊天复制给新电脑；本文件和 Git 历史是主要交接依据。
- 旧聊天可作为本地备份保留，但不要把 `.codex`、`auth.json` 或登录密钥提交到 GitHub。
- 修改前先检查线上数据绑定，部署前运行 `npm test`。
