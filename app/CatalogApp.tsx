"use client";

import { CSSProperties, FormEvent, useEffect, useMemo, useState } from "react";

type Product = {
  id: number;
  sku: string;
  name: string;
  model: string;
  style: string;
  category: string;
  price: number;
  material: string;
  size: string;
  packing_quantity: number;
  carton_volume: number;
  stock: number;
  notes: string;
  image_key: string | null;
};

type OrderLine = { cartons: number; unitsPerCarton: number };
type ProductDraft = { category: string; packingQuantity: number; cartonVolume: number };
type SiteSettings = {
  brandName: string;
  brandSubtitle: string;
  heroEyebrow: string;
  heroTitle: string;
  heroDescription: string;
  accent: string;
  accentDark: string;
  columns: number;
};

const defaultSettings: SiteSettings = {
  brandName: "阿斌皮具",
  brandSubtitle: "线上选品 · 按箱订货",
  heroEyebrow: "ABIN LEATHER GOODS",
  heroTitle: "选好款式，\n按箱快速订货。",
  heroDescription: "填写箱数，选择每箱数量，系统自动计算总数量和金额。",
  accent: "#df664e",
  accentDark: "#b94634",
  columns: 3,
};

const packOptions = [50, 60, 70, 80, 90, 100];
const palettes = ["peach", "lilac", "sage", "sand", "rose", "sky"];
const suggestedCategories = ["女包", "男包", "双肩包", "旅行包", "钱包/卡包", "配件", "其他"];

const defaultPack = (product: Product) => packOptions.includes(Number(product.packing_quantity)) ? Number(product.packing_quantity) : 100;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

async function imageToDataUrl(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("商品图片读取失败");
  const blob = await response.blob();
  if (blob.type === "image/jpeg" || blob.type === "image/png") {
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("商品图片转换失败"));
      reader.readAsDataURL(blob);
    });
  }
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas.toDataURL("image/png");
}

export default function CatalogApp({ adminMode = false, adminName = "" }: { adminMode?: boolean; adminName?: string }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("全部分类");
  const [orders, setOrders] = useState<Record<number, OrderLine>>({});
  const [drafts, setDrafts] = useState<Record<number, ProductDraft>>({});
  const [view, setView] = useState<"catalog" | "order" | "admin" | "appearance">(adminMode ? "admin" : "catalog");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [customer, setCustomer] = useState({ name: "", phone: "" });
  const [settings, setSettings] = useState<SiteSettings>(defaultSettings);
  const [settingsDraft, setSettingsDraft] = useState<SiteSettings>(defaultSettings);
  const [imagePreview, setImagePreview] = useState("");
  const [imageName, setImageName] = useState("");

  const loadProducts = async () => {
    try {
      const response = await fetch("/api/products");
      const data = await response.json() as { products?: Product[]; error?: string };
      if (!response.ok) throw new Error(data.error || "商品加载失败");
      const next = data.products ?? [];
      setProducts(next);
      setDrafts(Object.fromEntries(next.map((product) => [product.id, {
        category: product.category || "女包",
        packingQuantity: defaultPack(product),
        cartonVolume: Number(product.carton_volume) || 0,
      }])));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "商品加载失败");
    }
  };

  const loadSettings = async () => {
    try {
      const response = await fetch("/api/settings");
      const data = await response.json() as { settings?: SiteSettings; error?: string };
      if (!response.ok) throw new Error(data.error || "页面设置加载失败");
      const next = data.settings ?? defaultSettings;
      setSettings(next);
      setSettingsDraft(next);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "页面设置加载失败");
    }
  };

  useEffect(() => { void loadProducts(); void loadSettings(); }, []);
  useEffect(() => () => { if (imagePreview) URL.revokeObjectURL(imagePreview); }, [imagePreview]);

  const categories = useMemo(() => ["全部分类", ...Array.from(new Set(products.map((product) => product.category || "未分类")))], [products]);
  const filtered = useMemo(() => products.filter((product) => {
    const haystack = `${product.sku} ${product.name} ${product.model} ${product.style} ${product.category}`.toLowerCase();
    return haystack.includes(search.toLowerCase()) && (categoryFilter === "全部分类" || product.category === categoryFilter);
  }), [products, search, categoryFilter]);

  const orderFor = (product: Product): OrderLine => orders[product.id] ?? { cartons: 0, unitsPerCarton: defaultPack(product) };
  const setOrder = (product: Product, patch: Partial<OrderLine>) => setOrders((current) => {
    const previous = current[product.id] ?? { cartons: 0, unitsPerCarton: defaultPack(product) };
    return { ...current, [product.id]: { ...previous, ...patch } };
  });
  const selected = products.filter((product) => orderFor(product).cartons > 0);
  const totalCartons = selected.reduce((sum, product) => sum + orderFor(product).cartons, 0);
  const totalPieces = selected.reduce((sum, product) => {
    const order = orderFor(product);
    return sum + order.cartons * order.unitsPerCarton;
  }, 0);
  const totalAmount = selected.reduce((sum, product) => {
    const order = orderFor(product);
    return sum + order.cartons * order.unitsPerCarton * Number(product.price);
  }, 0);

  const exportExcel = async () => {
    if (!selected.length) return setNotice("请先选择商品并填写箱数");
    setExporting(true);
    setNotice("");
    try {
      const ExcelJSModule = await import("exceljs");
      const ExcelJS = ExcelJSModule.default;
      const templateResponse = await fetch("/order-template.xlsx");
      if (!templateResponse.ok) throw new Error("Excel 模板读取失败");
      const templateBytes = await templateResponse.arrayBuffer();
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(templateBytes as unknown as Buffer);
      workbook.calcProperties.fullCalcOnLoad = true;
      const sheet = workbook.getWorksheet("Sheet1") ?? workbook.worksheets[0];
      if (!sheet) throw new Error("Excel 模板工作表不存在");

      const productStyle = Array.from({ length: 16 }, (_, index) => clone(sheet.getRow(5).getCell(index + 2).style));
      const totalStyle = Array.from({ length: 16 }, (_, index) => clone(sheet.getRow(13).getCell(index + 2).style));
      const extraRows = Math.max(0, selected.length - 28);
      if (extraRows) {
        sheet.unMergeCells("D34:D36");
        sheet.insertRows(34, Array.from({ length: extraRows }, () => []));
        sheet.mergeCells(`D${34 + extraRows}:D${36 + extraRows}`);
      }
      (sheet as unknown as { _media: unknown[] })._media = [];

      const lastDataAreaRow = 33 + extraRows;
      for (let rowNumber = 5; rowNumber <= lastDataAreaRow; rowNumber++) {
        const row = sheet.getRow(rowNumber);
        for (let column = 2; column <= 17; column++) row.getCell(column).value = null;
      }

      sheet.getCell("K2").value = customer.name;
      sheet.getCell("K3").value = customer.phone;

      for (let index = 0; index < selected.length; index++) {
        const product = selected[index];
        const order = orderFor(product);
        const rowNumber = 5 + index;
        const row = sheet.getRow(rowNumber);
        row.height = 150;
        productStyle.forEach((style, styleIndex) => { row.getCell(styleIndex + 2).style = clone(style); });
        const totalQuantity = order.cartons * order.unitsPerCarton;
        const amount = totalQuantity * Number(product.price);
        const totalVolume = order.cartons * Number(product.carton_volume || 0);
        row.getCell("B").value = product.material;
        row.getCell("C").value = null;
        row.getCell("D").value = product.model;
        row.getCell("E").value = product.sku;
        row.getCell("F").value = product.name || product.category;
        row.getCell("G").value = [product.style, product.size].filter(Boolean).join(" / ");
        row.getCell("H").value = Number(product.price);
        row.getCell("I").value = order.cartons;
        row.getCell("J").value = order.unitsPerCarton;
        row.getCell("K").value = "个";
        row.getCell("L").value = { formula: `I${rowNumber}*J${rowNumber}`, result: totalQuantity };
        row.getCell("M").value = { formula: `H${rowNumber}*L${rowNumber}`, result: amount };
        row.getCell("N").value = Number(product.carton_volume || 0) || null;
        row.getCell("O").value = { formula: `I${rowNumber}*N${rowNumber}`, result: totalVolume };
        row.getCell("P").value = product.notes;

        if (product.image_key) {
          try {
            const base64 = await imageToDataUrl(`/api/images/${product.image_key}`);
            const extension = base64.startsWith("data:image/jpeg") ? "jpeg" : "png";
            const imageId = workbook.addImage({ base64, extension });
            sheet.addImage(imageId, {
              tl: { col: 2.04, row: rowNumber - 0.96 },
              br: { col: 2.96, row: rowNumber - 0.04 },
              editAs: "oneCell",
            });
          } catch {
            // Keep the image cell empty if one remote image cannot be read.
          }
        }
      }

      const totalRowNumber = 5 + selected.length;
      const totalRow = sheet.getRow(totalRowNumber);
      totalRow.height = 38;
      totalStyle.forEach((style, styleIndex) => { totalRow.getCell(styleIndex + 2).style = clone(style); });
      for (let column = 2; column <= 17; column++) totalRow.getCell(column).value = null;
      totalRow.getCell("I").value = totalCartons;
      totalRow.getCell("M").value = { formula: `SUM(M5:M${totalRowNumber - 1})`, result: totalAmount };
      const totalVolume = selected.reduce((sum, product) => sum + orderFor(product).cartons * Number(product.carton_volume || 0), 0);
      totalRow.getCell("O").value = { formula: `SUM(O5:O${totalRowNumber - 1})`, result: totalVolume };

      const output = await workbook.xlsx.writeBuffer();
      const blob = new Blob([output as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      const safeCustomer = (customer.name || "客户").replace(/[\\/:*?"<>|]/g, "-");
      link.download = `阿斌皮具－${safeCustomer}－装箱单.xlsx`;
      link.click();
      URL.revokeObjectURL(link.href);
      setNotice("Excel 已按 PA 模板生成，包含图片和完整框线");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Excel 生成失败");
    } finally {
      setExporting(false);
    }
  };

  const submitProduct = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    setLoading(true);
    setNotice("");
    const form = new FormData(formElement);
    try {
      const response = await fetch("/api/products", { method: "POST", body: form });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "保存失败");
      formElement.reset();
      setImagePreview("");
      setImageName("");
      await loadProducts();
      setNotice("商品已加入商品库");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "保存失败");
    } finally { setLoading(false); }
  };

  const saveProductSettings = async (product: Product) => {
    const draft = drafts[product.id];
    if (!draft) return;
    const response = await fetch("/api/products", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: product.id, ...draft }),
    });
    const data = await response.json() as { error?: string };
    if (!response.ok) return setNotice(data.error || "修改失败");
    await loadProducts();
    setNotice("商品分类和装箱资料已更新");
  };

  const deleteProduct = async (product: Product) => {
    if (!confirm(`确定删除「${product.name}」吗？删除后无法恢复。`)) return;
    const response = await fetch(`/api/products?id=${product.id}`, { method: "DELETE" });
    const data = await response.json() as { error?: string };
    if (!response.ok) return setNotice(data.error || "删除失败");
    setOrders((current) => { const next = { ...current }; delete next[product.id]; return next; });
    await loadProducts();
    setNotice("商品已删除");
  };

  const saveAppearance = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setNotice("");
    try {
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(settingsDraft),
      });
      const data = await response.json() as { settings?: SiteSettings; error?: string };
      if (!response.ok) throw new Error(data.error || "页面设置保存失败");
      const next = data.settings ?? settingsDraft;
      setSettings(next);
      setSettingsDraft(next);
      setNotice("页面外观已经更新，客户刷新后即可看到");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "页面设置保存失败");
    } finally {
      setLoading(false);
    }
  };

  const themeStyle = {
    "--accent": settings.accent,
    "--accent-dark": settings.accentDark,
    "--grid-columns": String(settings.columns),
  } as CSSProperties;

  return (
    <main className="catalog-app" style={themeStyle}>
      <header className="topbar">
        <button className="brand" onClick={() => setView("catalog")} aria-label="返回商品选品">
          <span className="brand-mark">AB</span><span><b>{settings.brandName}</b><small>{settings.brandSubtitle}</small></span>
        </button>
        <nav aria-label="主要导航">
          <button className={view === "catalog" ? "active" : ""} onClick={() => setView("catalog")}>商品选品</button>
          <button className={view === "order" ? "active" : ""} onClick={() => setView("order")}>订货单 <em>{selected.length}</em></button>
          {adminMode && <button className={view === "admin" ? "active" : ""} onClick={() => setView("admin")}>商品管理</button>}
          {adminMode && <button className={view === "appearance" ? "active" : ""} onClick={() => setView("appearance")}>页面设置</button>}
          {!adminMode && <a className="owner-link" href="/manage">店主管理</a>}
        </nav>
      </header>

      {view === "catalog" && <>
        <section className="hero">
          <div><span className="eyebrow">{settings.heroEyebrow}</span><h1>{settings.heroTitle}</h1><p>{settings.heroDescription}</p></div>
          <div className="hero-card"><span>线上商品库</span><strong>{products.length}<small> 款</small></strong><i>女包 · 背包 · 旅行包</i></div>
        </section>
        <section className="catalog-shell">
          <div className="toolbar">
            <label className="search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索货号、品名、型号、分类…" /></label>
            <div className="result-count">共 <b>{filtered.length}</b> 款商品</div>
          </div>
          <div className="chips">{categories.map((category) => <button key={category} className={categoryFilter === category ? "selected" : ""} onClick={() => setCategoryFilter(category)}>{category}</button>)}</div>
          {products.length === 0 ? <div className="empty catalog-empty"><b>商品库正在准备中</b><p>店主正在上传商品图片和资料，请稍后再来。</p>{adminMode && <button onClick={() => setView("admin")}>去上传商品</button>}</div> :
          <div className="product-grid">{filtered.map((product, index) => {
            const order = orderFor(product);
            return <article className="product-card" key={product.id}>
              <div className={`product-image ${palettes[index % palettes.length]}`}>
                {product.image_key ? <img src={`/api/images/${product.image_key}`} alt={product.name} /> : <><span className="bag-shape">◡</span><small>暂无商品图片</small></>}
                <span className="sku">{product.sku}</span>
              </div>
              <div className="product-info">
                <div className="title-row"><div><h3>{product.name}</h3><p>{product.category} · {product.model || product.style || "箱包"}</p></div><strong>¥{Number(product.price).toFixed(2)}</strong></div>
                <div className="meta"><span>{product.material || "材质待补充"}</span><span>{product.size || "尺寸待补充"}</span><span>{product.notes || "现货款"}</span></div>
                <div className="shipping-control">
                  <label><span>订购箱数</span><input type="number" min="0" step="1" value={order.cartons || ""} placeholder="填箱数" onChange={(event) => setOrder(product, { cartons: Math.max(0, Math.floor(Number(event.target.value) || 0)) })} /></label>
                  <label><span>每箱数量</span><select value={order.unitsPerCarton} onChange={(event) => setOrder(product, { unitsPerCarton: Number(event.target.value) })}>{packOptions.map((option) => <option key={option} value={option}>{option} 个</option>)}</select></label>
                </div>
                {order.cartons > 0 && <div className="calculated">{order.cartons} 箱 × {order.unitsPerCarton} 个 = <b>{order.cartons * order.unitsPerCarton} 个</b></div>}
              </div>
            </article>;
          })}</div>}
        </section>
      </>}

      {view === "order" && <section className="order-page">
        <div className="section-heading"><div><span className="eyebrow">PACKING LIST</span><h1>确认装箱单</h1><p>确认箱数和每箱数量后，按最新 PA 模板生成 Excel。</p></div><div className="order-summary"><span>{selected.length} 个款式</span><b>{totalCartons} 箱 / {totalPieces} 个</b><strong>¥{totalAmount.toLocaleString("zh-CN", { minimumFractionDigits: 2 })}</strong></div></div>
        <div className="order-layout">
          <div className="order-list">{selected.length ? selected.map((product, index) => {
            const order = orderFor(product);
            return <div className="order-row carton-row" key={product.id}>
              <span className={`mini-image ${palettes[index % palettes.length]}`}>{product.image_key ? <img src={`/api/images/${product.image_key}`} alt="" /> : "AB"}</span>
              <div className="order-name"><b>{product.name}</b><small>{product.sku} · {product.category}</small></div>
              <label className="compact-field"><span>箱数</span><input type="number" min="0" value={order.cartons} onChange={(event) => setOrder(product, { cartons: Math.max(0, Math.floor(Number(event.target.value) || 0)) })} /></label>
              <label className="compact-field"><span>每箱</span><select value={order.unitsPerCarton} onChange={(event) => setOrder(product, { unitsPerCarton: Number(event.target.value) })}>{packOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
              <div className="line-total"><small>{order.cartons * order.unitsPerCarton} 个</small>¥{(order.cartons * order.unitsPerCarton * Number(product.price)).toFixed(2)}</div>
            </div>;
          }) : <div className="empty"><b>订货单还是空的</b><p>先去商品选品页填写要订购的箱数。</p><button onClick={() => setView("catalog")}>去选商品</button></div>}</div>
          <aside className="customer-card"><h2>采购商资料</h2><label>采购商名称<input value={customer.name} onChange={(event) => setCustomer({ ...customer, name: event.target.value })} placeholder="将填写到模板的采购商栏" /></label><label>联系电话<input value={customer.phone} onChange={(event) => setCustomer({ ...customer, phone: event.target.value })} placeholder="将填写到模板的电话栏" /></label><div className="template-note"><b>严格使用最新 PA 模板</b><span>保留原表头、列宽、框线、公式和说明，并把商品图片写入“图片”列。</span></div><button className="export" onClick={exportExcel} disabled={exporting}>{exporting ? "正在生成含图片的 Excel…" : "下载 PA 格式 Excel"}<span>↓</span></button></aside>
        </div>
      </section>}

      {view === "admin" && <section className="admin-page">
        <div className="section-heading"><div><span className="eyebrow">PRODUCT MANAGER</span><h1>商品管理</h1><p>上传新商品，也可以在下方修改分类、装箱资料或删除商品。</p></div><div className="admin-note">每箱数量只能选择 50、60、70、80、90、100。图片会同时导出到 Excel。</div></div>
        <form className="product-form" onSubmit={submitProduct}>
          <label className={`image-upload ${imagePreview ? "has-image" : ""}`} htmlFor="product-image-input">
            <input id="product-image-input" type="file" name="image" accept="image/jpeg,image/png,image/webp" onChange={(event) => {
              const file = event.target.files?.[0];
              if (imagePreview) URL.revokeObjectURL(imagePreview);
              if (!file) { setImagePreview(""); setImageName(""); return; }
              setImagePreview(URL.createObjectURL(file));
              setImageName(file.name);
            }} />
            {imagePreview ? <><img className="upload-preview" src={imagePreview} alt="待上传商品预览" /><span className="change-image">更换照片</span><b>{imageName}</b><small>照片已选择，填写资料后点击保存</small></> : <><span>＋</span><b>点击选择商品照片</b><small>整块区域都可以点击 · JPG、PNG、WebP，不超过 12MB</small></>}
          </label>
          <div className="form-fields"><div className="form-grid">
            <label>工厂货号 *<input name="sku" required placeholder="如 8057#" /></label><label>中文名称 *<input name="name" required placeholder="如 女包" /></label>
            <label>客人货号/型号<input name="model" placeholder="选填" /></label><label>款式<input name="style" placeholder="如 单肩包" /></label>
            <label>单价 *<input name="price" required min="0" step="0.01" type="number" placeholder="0.00" /></label><label>箱包分类<input name="category" list="category-options" defaultValue="女包" /><datalist id="category-options">{suggestedCategories.map((category) => <option key={category} value={category} />)}</datalist></label>
            <label>材质<input name="material" placeholder="如 PU+涤纶内里" /></label><label>规格/尺寸<input name="size" placeholder="选填" /></label>
            <label>每箱数量<select name="packingQuantity" defaultValue="100">{packOptions.map((option) => <option key={option} value={option}>{option} 个</option>)}</select></label><label>单箱体积 m³<input name="cartonVolume" min="0" step="0.001" type="number" placeholder="如 0.200" /></label>
            <label>现有库存<input name="stock" min="0" type="number" defaultValue="0" /></label>
          </div><label>备注<textarea name="notes" placeholder="颜色、包装要求等" /></label><button className="save-product" disabled={loading}>{loading ? "正在保存…" : "保存并发布商品"}</button></div>
        </form>
        <div className="manage-list"><h2>已发布商品 <small>（{products.length}）</small></h2>{products.length ? products.map((product) => {
          const draft = drafts[product.id] ?? { category: product.category, packingQuantity: defaultPack(product), cartonVolume: Number(product.carton_volume) || 0 };
          return <div className="manage-product" key={product.id}>
            <span className="manage-thumb">{product.image_key ? <img src={`/api/images/${product.image_key}`} alt="" /> : "AB"}</span>
            <div className="manage-name"><b>{product.name}</b><small>{product.sku} · ¥{Number(product.price).toFixed(2)}</small></div>
            <label>分类<input value={draft.category} onChange={(event) => setDrafts({ ...drafts, [product.id]: { ...draft, category: event.target.value } })} /></label>
            <label>每箱<select value={draft.packingQuantity} onChange={(event) => setDrafts({ ...drafts, [product.id]: { ...draft, packingQuantity: Number(event.target.value) } })}>{packOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
            <label>单箱体积<input type="number" min="0" step="0.001" value={draft.cartonVolume || ""} onChange={(event) => setDrafts({ ...drafts, [product.id]: { ...draft, cartonVolume: Number(event.target.value) || 0 } })} /></label>
            <button className="save-row" onClick={() => saveProductSettings(product)}>保存修改</button><button className="delete-row" onClick={() => deleteProduct(product)}>删除商品</button>
          </div>;
        }) : <div className="manage-empty">还没有商品，请使用上方表单添加。</div>}</div>
      </section>}

      {view === "appearance" && adminMode && <section className="admin-page">
        <div className="section-heading"><div><span className="eyebrow">SITE APPEARANCE</span><h1>页面设置</h1><p>这些内容保存后会立即显示在客户看到的商品页面。</p></div><div className="admin-note">当前管理员：{adminName || "店主"}<br />商品、图片和订货Excel不会受到外观调整影响。</div></div>
        <form className="appearance-form" onSubmit={saveAppearance}>
          <div className="appearance-fields">
            <h2>店铺文字</h2>
            <label>店铺名称<input value={settingsDraft.brandName} onChange={(event) => setSettingsDraft({ ...settingsDraft, brandName: event.target.value })} /></label>
            <label>顶部副标题<input value={settingsDraft.brandSubtitle} onChange={(event) => setSettingsDraft({ ...settingsDraft, brandSubtitle: event.target.value })} /></label>
            <label>首页英文小标题<input value={settingsDraft.heroEyebrow} onChange={(event) => setSettingsDraft({ ...settingsDraft, heroEyebrow: event.target.value })} /></label>
            <label>首页主标题<textarea value={settingsDraft.heroTitle} onChange={(event) => setSettingsDraft({ ...settingsDraft, heroTitle: event.target.value })} /></label>
            <label>首页说明<textarea value={settingsDraft.heroDescription} onChange={(event) => setSettingsDraft({ ...settingsDraft, heroDescription: event.target.value })} /></label>
          </div>
          <div className="appearance-fields">
            <h2>颜色与排版</h2>
            <label>主色<input type="color" value={settingsDraft.accent} onChange={(event) => setSettingsDraft({ ...settingsDraft, accent: event.target.value })} /></label>
            <label>深色强调<input type="color" value={settingsDraft.accentDark} onChange={(event) => setSettingsDraft({ ...settingsDraft, accentDark: event.target.value })} /></label>
            <label>电脑端每行商品数<select value={settingsDraft.columns} onChange={(event) => setSettingsDraft({ ...settingsDraft, columns: Number(event.target.value) })}><option value="2">2 款（图片更大）</option><option value="3">3 款（推荐）</option><option value="4">4 款（显示更多）</option></select></label>
            <div className="theme-presets"><span>快速配色</span><button type="button" onClick={() => setSettingsDraft({ ...settingsDraft, accent: "#df664e", accentDark: "#b94634" })}>暖陶红</button><button type="button" onClick={() => setSettingsDraft({ ...settingsDraft, accent: "#8f6b5d", accentDark: "#60463c" })}>皮革棕</button><button type="button" onClick={() => setSettingsDraft({ ...settingsDraft, accent: "#365c59", accentDark: "#24413f" })}>墨绿色</button></div>
            <div className="appearance-preview" style={{ "--preview-accent": settingsDraft.accent } as CSSProperties}><span>AB</span><div><b>{settingsDraft.brandName || "店铺名称"}</b><small>{settingsDraft.heroTitle || "首页主标题"}</small></div></div>
          </div>
          <button className="save-product appearance-save" disabled={loading}>{loading ? "正在保存…" : "保存页面设置"}</button>
        </form>
      </section>}

      {selected.length > 0 && view === "catalog" && <button className="floating-order" onClick={() => setView("order")}><span><b>{selected.length}</b> 款 · {totalCartons} 箱 · {totalPieces} 个</span><strong>查看订货单　¥{totalAmount.toFixed(2)} →</strong></button>}
      {notice && <button className="toast" onClick={() => setNotice("")}>{notice}<span>×</span></button>}
      <footer><span>{settings.brandName} · 线上选品订货</span><small>商品资料以最终确认为准</small></footer>
    </main>
  );
}
