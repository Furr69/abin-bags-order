"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

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
  stock: number;
  notes: string;
  image_key: string | null;
};

const demoProducts: Product[] = [
  { id: -1, sku: "AB-2601", name: "云朵褶皱手提包", model: "M01", style: "通勤手提", category: "女包", price: 58, material: "PU", size: "28×13×20cm", packing_quantity: 40, stock: 320, notes: "黑/米白/焦糖", image_key: null },
  { id: -2, sku: "AB-2602", name: "法式腋下月牙包", model: "M02", style: "单肩腋下", category: "女包", price: 39, material: "PU", size: "25×7×14cm", packing_quantity: 60, stock: 480, notes: "可调节肩带", image_key: null },
  { id: -3, sku: "AB-2603", name: "菱格链条小方包", model: "M03", style: "斜挎链条", category: "女包", price: 46, material: "PU+五金", size: "20×7×13cm", packing_quantity: 50, stock: 210, notes: "经典菱格", image_key: null },
  { id: -4, sku: "AB-2604", name: "大容量托特购物袋", model: "M04", style: "托特包", category: "女包", price: 65, material: "帆布", size: "38×14×30cm", packing_quantity: 30, stock: 180, notes: "内置小包", image_key: null },
  { id: -5, sku: "AB-2605", name: "轻复古水桶包", model: "M05", style: "水桶包", category: "女包", price: 52, material: "PU", size: "22×12×23cm", packing_quantity: 40, stock: 260, notes: "抽绳开合", image_key: null },
  { id: -6, sku: "AB-2606", name: "迷你翻盖手机包", model: "M06", style: "迷你斜挎", category: "女包", price: 28, material: "PU", size: "12×4×19cm", packing_quantity: 80, stock: 600, notes: "手机零钱两用", image_key: null },
];

const palettes = ["peach", "lilac", "sage", "sand", "rose", "sky"];

export default function CatalogApp() {
  const [products, setProducts] = useState<Product[]>(demoProducts);
  const [isDemo, setIsDemo] = useState(true);
  const [search, setSearch] = useState("");
  const [style, setStyle] = useState("全部款式");
  const [quantities, setQuantities] = useState<Record<number, number>>({});
  const [view, setView] = useState<"catalog" | "order" | "admin">("catalog");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [customer, setCustomer] = useState({ name: "", phone: "", delivery: "", address: "", note: "" });

  const loadProducts = async () => {
    try {
      const response = await fetch("/api/products");
      const data = await response.json() as { products?: Product[] };
      if (response.ok && data.products?.length) {
        setProducts(data.products);
        setIsDemo(false);
      } else if (response.ok) {
        setProducts(demoProducts);
        setIsDemo(true);
      }
    } catch {
      setProducts(demoProducts);
      setIsDemo(true);
    }
  };

  useEffect(() => { void loadProducts(); }, []);

  const styles = useMemo(() => ["全部款式", ...Array.from(new Set(products.map((p) => p.style).filter(Boolean)))], [products]);
  const filtered = useMemo(() => products.filter((product) => {
    const haystack = `${product.sku} ${product.name} ${product.model} ${product.style}`.toLowerCase();
    return haystack.includes(search.toLowerCase()) && (style === "全部款式" || product.style === style);
  }), [products, search, style]);
  const selected = products.filter((product) => (quantities[product.id] ?? 0) > 0);
  const totalPieces = selected.reduce((sum, product) => sum + quantities[product.id], 0);
  const totalAmount = selected.reduce((sum, product) => sum + quantities[product.id] * Number(product.price), 0);

  const setQuantity = (id: number, next: number) => setQuantities((current) => ({ ...current, [id]: Math.max(0, Math.floor(next || 0)) }));

  const exportExcel = async () => {
    if (!selected.length) return setNotice("请先选择商品并填写数量");
    const XLSX = await import("xlsx");
    const date = new Date().toLocaleDateString("zh-CN");
    const rows: (string | number)[][] = [
      ["阿斌皮具 · 订货单"],
      ["客户：", customer.name, "电话：", customer.phone, "订货日期：", date],
      ["交货期：", customer.delivery, "收货地址：", customer.address],
      ["备注：", customer.note],
      [],
      ["序号", "货号", "品名", "型号", "款式", "数量", "单位", "单价", "合计", "装箱量", "箱数", "材料", "产品尺寸", "商品备注"],
      ...selected.map((product, index) => {
        const quantity = quantities[product.id];
        return [index + 1, product.sku, product.name, product.model, product.style, quantity, "个", Number(product.price), quantity * Number(product.price), product.packing_quantity, Math.ceil(quantity / product.packing_quantity), product.material, product.size, product.notes];
      }),
      ["", "", "总计", "", "", totalPieces, "个", "", totalAmount, "", "", "", "", ""],
    ];
    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    worksheet["!merges"] = [XLSX.utils.decode_range("A1:N1")];
    worksheet["!cols"] = [6, 14, 24, 12, 14, 10, 8, 10, 14, 10, 10, 14, 18, 24].map((wch) => ({ wch }));
    worksheet["!rows"] = [{ hpt: 28 }, { hpt: 22 }, { hpt: 22 }, { hpt: 22 }, {}, { hpt: 26 }];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "订货单");
    XLSX.writeFile(workbook, `阿斌皮具订货单_${customer.name || "客户"}_${date.replaceAll("/", "-")}.xlsx`);
    setNotice("订货 Excel 已生成");
  };

  const submitProduct = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setNotice("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/products", { method: "POST", body: form });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "保存失败");
      event.currentTarget.reset();
      await loadProducts();
      setNotice("商品已加入线上商品库");
      setView("catalog");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "保存失败");
    } finally { setLoading(false); }
  };

  const deleteProduct = async (id: number) => {
    if (id < 0 || !confirm("确定删除这个商品吗？")) return;
    const response = await fetch(`/api/products?id=${id}`, { method: "DELETE" });
    if (response.ok) { await loadProducts(); setNotice("商品已删除"); }
  };

  return (
    <main>
      <header className="topbar">
        <button className="brand" onClick={() => setView("catalog")} aria-label="返回商品选品">
          <span className="brand-mark">AB</span><span><b>阿斌皮具</b><small>线上选品 · 快速订货</small></span>
        </button>
        <nav aria-label="主要导航">
          <button className={view === "catalog" ? "active" : ""} onClick={() => setView("catalog")}>商品选品</button>
          <button className={view === "order" ? "active" : ""} onClick={() => setView("order")}>订货单 <em>{selected.length}</em></button>
          <button className={view === "admin" ? "active" : ""} onClick={() => setView("admin")}>商品管理</button>
        </nav>
      </header>

      {view === "catalog" && <>
        <section className="hero">
          <div><span className="eyebrow">2026 NEW COLLECTION</span><h1>喜欢的款式，<br />直接加入订货单。</h1><p>查看商品图片与资料，填写数量，一键生成 Excel。</p></div>
          <div className="hero-card"><span>本季新品</span><strong>{products.length}<small> 款</small></strong><i>女包 · 通勤 · 休闲</i></div>
        </section>
        <section className="catalog-shell">
          <div className="toolbar">
            <label className="search"><span>⌕</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索货号、品名、型号…" /></label>
            <div className="result-count">共 <b>{filtered.length}</b> 款商品</div>
          </div>
          <div className="chips">{styles.map((item) => <button key={item} className={style === item ? "selected" : ""} onClick={() => setStyle(item)}>{item}</button>)}</div>
          {isDemo && <div className="demo-tip"><b>示例商品</b> 当前展示的是界面示例；在“商品管理”上传第一件商品后，会自动切换成你的真实商品库。</div>}
          <div className="product-grid">{filtered.map((product, index) => {
            const quantity = quantities[product.id] ?? 0;
            return <article className="product-card" key={product.id}>
              <div className={`product-image ${palettes[index % palettes.length]}`}>
                {product.image_key ? <img src={`/api/images/${product.image_key}`} alt={product.name} /> : <><span className="bag-shape">◡</span><small>商品图片</small></>}
                <span className="sku">{product.sku}</span>
              </div>
              <div className="product-info"><div className="title-row"><div><h3>{product.name}</h3><p>{product.model} · {product.style}</p></div><strong>¥{Number(product.price).toFixed(2)}</strong></div>
                <div className="meta"><span>{product.material || "材质待补充"}</span><span>{product.size || "尺寸待补充"}</span><span>{product.notes || "现货款"}</span></div>
                <div className="order-control"><span>订购数量</span><div><button onClick={() => setQuantity(product.id, quantity - 1)} aria-label="减少数量">−</button><input type="number" min="0" value={quantity || ""} placeholder="0" onChange={(e) => setQuantity(product.id, Number(e.target.value))} /><button onClick={() => setQuantity(product.id, quantity + 1)} aria-label="增加数量">＋</button></div></div>
              </div>
            </article>;
          })}</div>
        </section>
      </>}

      {view === "order" && <section className="order-page">
        <div className="section-heading"><div><span className="eyebrow">ORDER SHEET</span><h1>确认订货单</h1><p>填写客户资料，确认数量后生成 Excel。</p></div><div className="order-summary"><span>{selected.length} 个款式</span><b>{totalPieces} 件</b><strong>¥{totalAmount.toLocaleString("zh-CN", { minimumFractionDigits: 2 })}</strong></div></div>
        <div className="order-layout">
          <div className="order-list">{selected.length ? selected.map((product, index) => <div className="order-row" key={product.id}><span className={`mini-image ${palettes[index % palettes.length]}`}>{product.image_key ? <img src={`/api/images/${product.image_key}`} alt="" /> : "AB"}</span><div className="order-name"><b>{product.name}</b><small>{product.sku} · {product.style}</small></div><div className="inline-qty"><button onClick={() => setQuantity(product.id, quantities[product.id] - 1)}>−</button><input value={quantities[product.id]} type="number" onChange={(e) => setQuantity(product.id, Number(e.target.value))} /><button onClick={() => setQuantity(product.id, quantities[product.id] + 1)}>＋</button></div><div className="line-total">¥{(quantities[product.id] * Number(product.price)).toFixed(2)}</div></div>) : <div className="empty"><b>订货单还是空的</b><p>先去商品选品页填写要订购的数量。</p><button onClick={() => setView("catalog")}>去选商品</button></div>}</div>
          <aside className="customer-card"><h2>客户与交货资料</h2><label>客户名称<input value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} placeholder="公司或客户名称" /></label><label>联系电话<input value={customer.phone} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} placeholder="手机 / WhatsApp" /></label><label>期望交货日期<input type="date" value={customer.delivery} onChange={(e) => setCustomer({ ...customer, delivery: e.target.value })} /></label><label>收货地址<textarea value={customer.address} onChange={(e) => setCustomer({ ...customer, address: e.target.value })} placeholder="详细收货地址" /></label><label>订单备注<textarea value={customer.note} onChange={(e) => setCustomer({ ...customer, note: e.target.value })} placeholder="颜色、包装等说明" /></label><button className="export" onClick={exportExcel}>下载 Excel 订货单 <span>↓</span></button><small>生成格式已参考你现有的“装柜”订货表。</small></aside>
        </div>
      </section>}

      {view === "admin" && <section className="admin-page">
        <div className="section-heading"><div><span className="eyebrow">PRODUCT MANAGER</span><h1>上传新商品</h1><p>图片与商品资料会长期保存，客户刷新后也能看到。</p></div><div className="admin-note">建议图片使用正方形或 4:5 竖图，单张不超过 12MB。</div></div>
        <form className="product-form" onSubmit={submitProduct}>
          <label className="image-upload"><input type="file" name="image" accept="image/*" /><span>＋</span><b>点击上传商品图片</b><small>JPG、PNG、WebP</small></label>
          <div className="form-fields"><div className="form-grid"><label>货号 *<input name="sku" required placeholder="如 AB-2608" /></label><label>品名 *<input name="name" required placeholder="如 法式腋下包" /></label><label>型号<input name="model" placeholder="如 M08" /></label><label>款式<input name="style" placeholder="如 斜挎包" /></label><label>大致价格 *<input name="price" required min="0" step="0.01" type="number" placeholder="0.00" /></label><label>分类<input name="category" defaultValue="女包" /></label><label>材料<input name="material" placeholder="PU / 真皮 / 帆布" /></label><label>产品尺寸<input name="size" placeholder="长×宽×高 cm" /></label><label>装箱量<input name="packingQuantity" min="1" type="number" defaultValue="1" /></label><label>现有库存<input name="stock" min="0" type="number" defaultValue="0" /></label></div><label>其他说明<textarea name="notes" placeholder="颜色、五金、包装方式等" /></label><button className="save-product" disabled={loading}>{loading ? "正在保存…" : "保存并发布商品"}</button></div>
        </form>
        {!isDemo && <div className="manage-list"><h2>已发布商品</h2>{products.map((product) => <div key={product.id}><span>{product.sku}</span><b>{product.name}</b><small>¥{Number(product.price).toFixed(2)}</small><button onClick={() => deleteProduct(product.id)}>删除</button></div>)}</div>}
      </section>}

      {selected.length > 0 && view === "catalog" && <button className="floating-order" onClick={() => setView("order")}><span><b>{selected.length}</b> 款 · {totalPieces} 件</span><strong>查看订货单　¥{totalAmount.toFixed(2)} →</strong></button>}
      {notice && <button className="toast" onClick={() => setNotice("")}>{notice}<span>×</span></button>}
      <footer><span>阿斌皮具 · 线上选品订货</span><small>商品资料以最终确认为准</small></footer>
    </main>
  );
}
