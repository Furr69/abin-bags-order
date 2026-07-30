"use client";

import { CSSProperties, FormEvent, useEffect, useMemo, useRef, useState } from "react";

type Product = {
  id: number;
  sku: string;
  name: string;
  model: string;
  style: string;
  category: string;
  factory: string;
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
type UploadItem = { id: string; file: File; preview: string; sku: string; recognizing: boolean; ocrNote: string };
type WritablePhotoFile = { write(data: Blob): Promise<void>; close(): Promise<void> };
type PhotoDirectory = {
  getFileHandle(name: string, options: { create: true }): Promise<{ createWritable(): Promise<WritablePhotoFile> }>;
};
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

const maxUploadBytes = 1_500_000;

async function optimizeImageForUpload(file: File) {
  if (file.size <= maxUploadBytes) return file;
  const bitmap = await createImageBitmap(file);
  const longestSide = Math.max(bitmap.width, bitmap.height);
  let maxSide = Math.min(2000, longestSide);
  let output: Blob | null = null;

  for (let attempt = 0; attempt < 7; attempt++) {
    const scale = Math.min(1, maxSide / longestSide);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) break;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const quality = Math.max(0.56, 0.84 - attempt * 0.05);
    output = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (output && output.size <= maxUploadBytes) break;
    maxSide *= 0.82;
  }

  bitmap.close();
  if (!output) throw new Error("图片处理失败，请换一张图片重试");
  const baseName = file.name.replace(/\.[^.]+$/, "") || "product";
  return new File([output], `${baseName}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
}

async function makeHighContrastOcrImage(file: File) {
  const bitmap = await createImageBitmap(file);
  const longestSide = Math.max(bitmap.width, bitmap.height);
  const scale = Math.min(2, 2400 / longestSide);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    bitmap.close();
    throw new Error("照片预处理失败");
  }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const histogram = new Uint32Array(256);
  for (let offset = 0; offset < imageData.data.length; offset += 4) {
    const grey = Math.round(imageData.data[offset] * 0.299 + imageData.data[offset + 1] * 0.587 + imageData.data[offset + 2] * 0.114);
    histogram[grey]++;
  }
  const total = canvas.width * canvas.height;
  let sum = 0;
  for (let value = 0; value < 256; value++) sum += value * histogram[value];
  let backgroundWeight = 0;
  let backgroundSum = 0;
  let bestVariance = -1;
  let threshold = 165;
  for (let value = 0; value < 256; value++) {
    backgroundWeight += histogram[value];
    if (!backgroundWeight) continue;
    const foregroundWeight = total - backgroundWeight;
    if (!foregroundWeight) break;
    backgroundSum += value * histogram[value];
    const backgroundMean = backgroundSum / backgroundWeight;
    const foregroundMean = (sum - backgroundSum) / foregroundWeight;
    const variance = backgroundWeight * foregroundWeight * (backgroundMean - foregroundMean) ** 2;
    if (variance > bestVariance) {
      bestVariance = variance;
      threshold = value;
    }
  }
  for (let offset = 0; offset < imageData.data.length; offset += 4) {
    const grey = Math.round(imageData.data[offset] * 0.299 + imageData.data[offset + 1] * 0.587 + imageData.data[offset + 2] * 0.114);
    const binary = grey > threshold ? 255 : 0;
    imageData.data[offset] = binary;
    imageData.data[offset + 1] = binary;
    imageData.data[offset + 2] = binary;
  }
  context.putImageData(imageData, 0, 0);
  return canvas;
}

function skuCandidate(text: string) {
  const normalized = text.replace(/＃/g, "#").replace(/\s/g, "");
  return normalized.match(/(\d{2,20})#/)?.[1] || "";
}

async function readApiResponse(response: Response) {
  const body = await response.text();
  if (response.status === 413) return { error: "图片仍然太大，请换一张图片重试" };
  try {
    return JSON.parse(body) as { error?: string };
  } catch {
    return { error: body || "服务器返回了无法识别的内容" };
  }
}

async function imageToExcelDataUrl(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("商品图片读取失败");
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = 900;
  canvas.height = 1200;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("商品图片转换失败");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  const padding = 28;
  const scale = Math.min((canvas.width - padding * 2) / bitmap.width, (canvas.height - padding * 2) / bitmap.height);
  const width = bitmap.width * scale;
  const height = bitmap.height * scale;
  context.drawImage(bitmap, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
  bitmap.close();
  return canvas.toDataURL("image/png");
}

export default function CatalogApp({ adminMode = false, adminName = "" }: { adminMode?: boolean; adminName?: string }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("全部分类");
  const [factoryFilter, setFactoryFilter] = useState("全部厂家");
  const [orders, setOrders] = useState<Record<number, OrderLine>>({});
  const [editingId, setEditingId] = useState<number | null>(null);
  const [view, setView] = useState<"catalog" | "order" | "admin" | "appearance">(adminMode ? "admin" : "catalog");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [customer, setCustomer] = useState({ name: "", phone: "" });
  const [settings, setSettings] = useState<SiteSettings>(defaultSettings);
  const [settingsDraft, setSettingsDraft] = useState<SiteSettings>(defaultSettings);
  const [uploadItems, setUploadItems] = useState<UploadItem[]>([]);
  const [uploadProgress, setUploadProgress] = useState("");
  const [uploadPreview, setUploadPreview] = useState<{ id: string; src: string; label: string } | null>(null);
  const [lightbox, setLightbox] = useState<Product | null>(null);
  const [lightboxZoomed, setLightboxZoomed] = useState(false);
  const [priceDrafts, setPriceDrafts] = useState<Record<number, string>>({});
  const [savingPriceId, setSavingPriceId] = useState<number | null>(null);
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<number[]>([]);
  const [photoAction, setPhotoAction] = useState<"download" | "copy" | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const loadProducts = async () => {
    try {
      const response = await fetch("/api/products");
      const data = await response.json() as { products?: Product[]; error?: string };
      if (!response.ok) throw new Error(data.error || "商品加载失败");
      const next = data.products ?? [];
      setProducts(next);
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
  useEffect(() => {
    if (!lightbox && !uploadPreview) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setLightbox(null);
        setUploadPreview(null);
        setLightboxZoomed(false);
      }
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", closeOnEscape); };
  }, [lightbox, uploadPreview]);

  const categories = useMemo(() => ["全部分类", ...Array.from(new Set(products.map((product) => product.category || "未分类")))], [products]);
  const factories = useMemo(() => ["全部厂家", ...Array.from(new Set(products.map((product) => product.factory || "未标厂家")))], [products]);
  const filtered = useMemo(() => products.filter((product) => {
    const haystack = `${product.sku} ${product.name} ${product.model} ${product.style} ${product.category} ${product.factory}`.toLowerCase();
    return haystack.includes(search.toLowerCase())
      && (categoryFilter === "全部分类" || product.category === categoryFilter)
      && (factoryFilter === "全部厂家" || (product.factory || "未标厂家") === factoryFilter);
  }), [products, search, categoryFilter, factoryFilter]);

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
  const hasPricedSelection = selected.some((product) => Number(product.price) > 0);
  const selectedPhotos = products.filter((product) => selectedPhotoIds.includes(product.id) && product.image_key);
  const visiblePhotoIds = filtered.filter((product) => product.image_key).map((product) => product.id);
  const factoryPhotos = factoryFilter === "全部厂家"
    ? []
    : products.filter((product) => (product.factory || "未标厂家") === factoryFilter && product.image_key);

  const safeFilePart = (value: string) => value.replace(/[\\/:*?"<>|]/g, "-").trim() || "商品照片";

  const fetchProductPhoto = async (product: Product) => {
    if (!product.image_key) throw new Error(`${product.sku} 没有照片`);
    const response = await fetch(`/api/images/${encodeURIComponent(product.image_key)}`);
    if (!response.ok) throw new Error(`${product.sku} 照片读取失败`);
    const blob = await response.blob();
    const extension = product.image_key.split(".").pop()?.toLowerCase() || (blob.type === "image/png" ? "png" : "jpg");
    return { blob, filename: `${safeFilePart(product.sku || product.name)}.${extension}` };
  };

  const savePhotosToFolder = async (items: Product[]) => {
    const photos = items.filter((product) => product.image_key);
    if (!photos.length) return setNotice("没有可保存的照片");
    const chooseFolder = (window as unknown as {
      showDirectoryPicker?: (options: { mode: "readwrite" }) => Promise<PhotoDirectory>;
    }).showDirectoryPicker?.bind(window);
    if (!chooseFolder) return setNotice("请使用电脑上的 Chrome 或 Edge，才能直接选择文件夹保存");
    setPhotoAction("download");
    try {
      const directory = await chooseFolder({ mode: "readwrite" });
      const usedNames = new Set<string>();
      for (let index = 0; index < photos.length; index++) {
        const photo = await fetchProductPhoto(photos[index]);
        let filename = photo.filename;
        if (usedNames.has(filename)) {
          const dot = filename.lastIndexOf(".");
          filename = `${filename.slice(0, dot)}-${index + 1}${filename.slice(dot)}`;
        }
        usedNames.add(filename);
        setNotice(`正在保存第 ${index + 1}/${photos.length} 张照片…`);
        const fileHandle = await directory.getFileHandle(filename, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(photo.blob);
        await writable.close();
      }
      setNotice(`${photos.length} 张照片已直接保存到你选择的文件夹`);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setNotice("已取消选择文件夹");
      } else {
        setNotice(error instanceof Error ? error.message : "照片保存失败");
      }
    } finally {
      setPhotoAction(null);
    }
  };

  const photoBlobAsPng = async (blob: Blob) => {
    if (blob.type === "image/png") return blob;
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) {
      bitmap.close();
      throw new Error("照片转换失败");
    }
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!png) throw new Error("照片转换失败");
    return png;
  };

  const copyOrSharePhotos = async (items: Product[]) => {
    const photos = items.filter((product) => product.image_key);
    if (!photos.length) return setNotice("请先勾选照片");
    if (photos.length > 1) return setNotice("复制照片一次只能选 1 张；多张请保存到文件夹");
    setPhotoAction("copy");
    setNotice("正在准备照片…");
    try {
      const fetched = await fetchProductPhoto(photos[0]);
      if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") throw new Error("当前浏览器不支持复制照片");
      const pngBlob = await photoBlobAsPng(fetched.blob);
      await navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlob })]);
      setNotice("照片已复制，可以直接粘贴");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setNotice("已取消复制");
      } else {
        setNotice(error instanceof Error ? error.message : "照片复制失败");
      }
    } finally {
      setPhotoAction(null);
    }
  };

  const togglePhotoSelection = (id: number) => setSelectedPhotoIds((current) =>
    current.includes(id) ? current.filter((selectedId) => selectedId !== id) : [...current, id]);

  const toggleVisiblePhotos = () => setSelectedPhotoIds((current) => {
    const allVisibleSelected = visiblePhotoIds.length > 0 && visiblePhotoIds.every((id) => current.includes(id));
    return allVisibleSelected
      ? current.filter((id) => !visiblePhotoIds.includes(id))
      : Array.from(new Set([...current, ...visiblePhotoIds]));
  });

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
        row.height = 170;
        productStyle.forEach((style, styleIndex) => { row.getCell(styleIndex + 2).style = clone(style); });
        const totalQuantity = order.cartons * order.unitsPerCarton;
        const hasPrice = Number(product.price) > 0;
        const amount = hasPrice ? totalQuantity * Number(product.price) : 0;
        const totalVolume = order.cartons * Number(product.carton_volume || 0);
        row.getCell("B").value = product.material;
        row.getCell("C").value = null;
        row.getCell("D").value = product.model;
        row.getCell("E").value = product.sku;
        row.getCell("F").value = product.name || product.category;
        row.getCell("G").value = [product.style, product.size].filter(Boolean).join(" / ");
        row.getCell("H").value = hasPrice ? Number(product.price) : null;
        row.getCell("I").value = order.cartons;
        row.getCell("J").value = order.unitsPerCarton;
        row.getCell("K").value = "个";
        row.getCell("L").value = { formula: `I${rowNumber}*J${rowNumber}`, result: totalQuantity };
        row.getCell("M").value = hasPrice ? { formula: `H${rowNumber}*L${rowNumber}`, result: amount } : null;
        row.getCell("N").value = Number(product.carton_volume || 0) || null;
        row.getCell("O").value = { formula: `I${rowNumber}*N${rowNumber}`, result: totalVolume };
        row.getCell("P").value = [product.factory ? `厂家：${product.factory}` : "", product.notes].filter(Boolean).join("；");

        if (product.image_key) {
          try {
            const base64 = await imageToExcelDataUrl(`/api/images/${product.image_key}`);
            const imageId = workbook.addImage({ base64, extension: "png" });
            sheet.addImage(imageId, {
              tl: { col: 2, row: rowNumber - 1 },
              ext: { width: 128, height: 218 },
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

  const chooseUploadFiles = async (files: File[]) => {
    uploadItems.forEach((item) => URL.revokeObjectURL(item.preview));
    const nextItems = files.map((file, index) => ({
      id: `${file.name}-${file.lastModified}-${index}`,
      file,
      preview: URL.createObjectURL(file),
      sku: "",
      recognizing: true,
      ocrNote: "",
    }));
    setUploadItems(nextItems);
    setUploadProgress(files.length ? "正在识别照片中的 # 货号…" : "");
    if (!files.length) return;

    try {
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker("eng");
      try {
        await worker.setParameters({
          tessedit_char_whitelist: "0123456789#",
          tessedit_pageseg_mode: "11",
          preserve_interword_spaces: "1",
        });
        for (let index = 0; index < nextItems.length; index++) {
          const item = nextItems[index];
          setUploadProgress(`正在增强并核对第 ${index + 1}/${nextItems.length} 张照片…`);
          const enhancedImage = await makeHighContrastOcrImage(item.file);
          const enhancedResult = await worker.recognize(enhancedImage);
          const enhancedSku = skuCandidate(enhancedResult.data.text);
          const confidentEnhanced = Boolean(enhancedSku && enhancedResult.data.confidence >= 72);
          let originalSku = "";
          let originalConfidence = 0;
          if (!confidentEnhanced) {
            const originalResult = await worker.recognize(item.file);
            originalSku = skuCandidate(originalResult.data.text);
            originalConfidence = originalResult.data.confidence;
          }
          const agreed = enhancedSku && enhancedSku === originalSku;
          const confidentOriginal = originalSku && originalConfidence >= 72;
          const recognizedSku = agreed || confidentEnhanced ? enhancedSku : confidentOriginal ? originalSku : "";
          setUploadItems((current) => current.map((currentItem) => currentItem.id === item.id
            ? {
              ...currentItem,
              sku: currentItem.sku || recognizedSku,
              recognizing: false,
              ocrNote: recognizedSku ? "已自动识别，请看照片核对" : "识别结果不可靠，已留空，可直接手动填写",
            }
            : currentItem));
        }
      } finally {
        await worker.terminate();
      }
      setUploadProgress("识别完成；不确定的结果已留空，避免填错货号");
    } catch {
      setUploadItems((current) => current.map((item) => ({ ...item, recognizing: false, ocrNote: "未能可靠识别，请看照片手动填写" })));
      setUploadProgress("自动识别未完成，请手动填写未识别的货号");
    }
  };

  const removeUploadItem = (id: string) => {
    if (uploadPreview?.id === id) setUploadPreview(null);
    setUploadItems((current) => {
      const removed = current.find((item) => item.id === id);
      if (removed) URL.revokeObjectURL(removed.preview);
      return current.filter((item) => item.id !== id);
    });
  };

  const updateUploadSku = (id: string, value: string) => {
    const normalized = value.replace(/#/g, "").slice(0, 40);
    setUploadItems((current) => current.map((item) => item.id === id
      ? { ...item, sku: normalized, ocrNote: normalized ? "已填写，按回车看下一张" : "请填写货号" }
      : item));
  };

  const advanceUploadPreview = () => {
    if (!uploadPreview) return;
    const currentIndex = uploadItems.findIndex((item) => item.id === uploadPreview.id);
    const currentItem = uploadItems[currentIndex];
    if (!currentItem?.sku.trim()) {
      setNotice("请先填写这张照片的货号");
      return;
    }
    const nextIndex = uploadItems.findIndex((item, index) => index > currentIndex && !item.sku.trim());
    const fallbackIndex = uploadItems.findIndex((item, index) => index !== currentIndex && !item.sku.trim());
    const targetIndex = nextIndex >= 0 ? nextIndex : fallbackIndex;
    if (targetIndex < 0) {
      setUploadPreview(null);
      setLightboxZoomed(false);
      setNotice("这批照片的货号已全部填写，可以直接保存");
      return;
    }
    const target = uploadItems[targetIndex];
    setLightboxZoomed(false);
    setUploadPreview({ id: target.id, src: target.preview, label: `第 ${targetIndex + 1} 张待上传照片` });
  };

  const openLightbox = (product: Product) => {
    setUploadPreview(null);
    setLightboxZoomed(false);
    setLightbox(product);
  };

  const submitProduct = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    if (!uploadItems.length) return setNotice("请先选择商品照片");
    const baseForm = new FormData(formElement);
    const factory = String(baseForm.get("factory") ?? "").trim();
    if (!factory) return setNotice("请先填写厂家，再保存这批照片");
    const missingSkuIndex = uploadItems.findIndex((item) => !item.sku.trim());
    if (missingSkuIndex >= 0) {
      const missingItem = uploadItems[missingSkuIndex];
      setUploadPreview({ id: missingItem.id, src: missingItem.preview, label: `第 ${missingSkuIndex + 1} 张待上传照片` });
      setLightboxZoomed(false);
      setNotice(`还有 ${uploadItems.filter((item) => !item.sku.trim()).length} 张照片未填写货号`);
      return;
    }
    setLoading(true);
    setNotice("");
    const failures: string[] = [];
    let saved = 0;
    try {
      for (let index = 0; index < uploadItems.length; index++) {
        const item = uploadItems[index];
        setUploadProgress(`正在保存第 ${index + 1}/${uploadItems.length} 张照片…`);
        const form = new FormData();
        for (const [key, value] of baseForm.entries()) {
          if (key !== "image" && key !== "sku" && key !== "name") form.append(key, value);
        }
        form.set("sku", item.sku.trim());
        form.set("name", `${item.sku.trim()}#`);
        form.set("image", await optimizeImageForUpload(item.file));
        const response = await fetch("/api/products", { method: "POST", body: form });
        const data = await readApiResponse(response);
        if (response.ok) saved++;
        else failures.push(`${item.sku || `第 ${index + 1} 张`}：${data.error || "保存失败"}`);
      }
      if (saved) await loadProducts();
      if (!failures.length) {
        uploadItems.forEach((item) => URL.revokeObjectURL(item.preview));
        setUploadItems([]);
        setUploadPreview(null);
        setLightboxZoomed(false);
        formElement.reset();
        setUploadProgress("");
        setNotice(`${saved} 张照片已保存到图片库`);
      } else {
        setUploadProgress("");
        setNotice(`已保存 ${saved} 张；${failures.slice(0, 2).join("；")}`);
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "批量保存失败");
    } finally {
      setLoading(false);
    }
  };

  const updateProduct = async (event: FormEvent<HTMLFormElement>, product: Product) => {
    event.preventDefault();
    setLoading(true);
    setNotice("");
    try {
      const form = new FormData(event.currentTarget);
      form.set("id", String(product.id));
      const image = form.get("image");
      if (image instanceof File && image.size > 0) form.set("image", await optimizeImageForUpload(image));
      const response = await fetch("/api/products", { method: "PUT", body: form });
      const data = await readApiResponse(response);
      if (!response.ok) throw new Error(data.error || "修改失败");
      await loadProducts();
      setEditingId(null);
      setNotice("商品全部资料和照片已更新");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "修改失败");
    } finally {
      setLoading(false);
    }
  };

  const saveProductPrice = async (product: Product, rawPrice: string) => {
    const trimmed = rawPrice.trim();
    const price = trimmed === "" ? 0 : Number(trimmed);
    if (!Number.isFinite(price) || price < 0) return setNotice("价格需要是有效的非负数，也可以留空");
    if (price === Number(product.price)) return;
    setSavingPriceId(product.id);
    setNotice("");
    try {
      const response = await fetch("/api/products", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: product.id, price: trimmed }),
      });
      const data = await readApiResponse(response);
      if (!response.ok) throw new Error(data.error || "价格保存失败");
      setProducts((current) => current.map((item) => item.id === product.id ? { ...item, price } : item));
      setPriceDrafts((current) => ({ ...current, [product.id]: trimmed }));
      setNotice(trimmed ? "价格已保存" : "价格已清空");
    } catch (error) {
      setPriceDrafts((current) => ({ ...current, [product.id]: Number(product.price) > 0 ? String(product.price) : "" }));
      setNotice(error instanceof Error ? error.message : "价格保存失败");
    } finally {
      setSavingPriceId(null);
    }
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
  const previewUploadItem = uploadPreview ? uploadItems.find((item) => item.id === uploadPreview.id) ?? null : null;

  return (
    <main className="catalog-app" style={themeStyle}>
      <header className="topbar">
        <button className="brand" onClick={() => setView("catalog")} aria-label="返回图片库">
          <span className="brand-mark">AB</span><span><b>{settings.brandName}</b><small>{settings.brandSubtitle}</small></span>
        </button>
        <nav aria-label="主要导航">
          <button className={view === "catalog" ? "active" : ""} onClick={() => setView("catalog")}>图片库</button>
          <button className={view === "order" ? "active" : ""} onClick={() => setView("order")}>生成 Excel <em>{selected.length}</em></button>
          <button className={view === "admin" ? "active" : ""} onClick={() => setView("admin")}>上传图片</button>
        </nav>
      </header>

      {view === "catalog" && <>
        <section className="hero">
          <div><span className="eyebrow">PRIVATE PHOTO ARCHIVE</span><h1>我的商品图片库</h1><p>所有图片仅店主账号可见，点击任意图片即可放大查看或保存到电脑。</p></div>
          <div className="hero-card"><span>已保存图片</span><strong>{products.filter((product) => product.image_key).length}<small> 张</small></strong><i>安全保存 · 随时查看</i></div>
        </section>
        <section className="catalog-shell">
          <div className="toolbar">
            <label className="search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索货号、品名、型号、分类…" /></label>
            <div className="result-count">共 <b>{filtered.length}</b> 款商品</div>
          </div>
          <div className="factory-filter"><span>厂家</span><div className="chips">{factories.map((factory) => <button key={factory} className={factoryFilter === factory ? "selected" : ""} onClick={() => setFactoryFilter(factory)}>{factory}</button>)}</div></div>
          <div className="chips">{categories.map((category) => <button key={category} className={categoryFilter === category ? "selected" : ""} onClick={() => setCategoryFilter(category)}>{category}</button>)}</div>
          {products.length > 0 && <div className="photo-batch-bar">
            <div>
              <button type="button" className="batch-select-button" onClick={toggleVisiblePhotos}>
                {visiblePhotoIds.length > 0 && visiblePhotoIds.every((id) => selectedPhotoIds.includes(id)) ? "取消全选" : "全选当前照片"}
              </button>
              <span>已选 <b>{selectedPhotos.length}</b> 张</span>
            </div>
            <div className="photo-batch-actions">
              {factoryFilter !== "全部厂家" && <button type="button" onClick={() => void savePhotosToFolder(factoryPhotos)} disabled={photoAction !== null || !factoryPhotos.length}>保存该厂全部 {factoryPhotos.length} 张</button>}
              <button type="button" onClick={() => void copyOrSharePhotos(selectedPhotos)} disabled={photoAction !== null || selectedPhotos.length !== 1}>{photoAction === "copy" ? "正在复制…" : selectedPhotos.length > 1 ? "复制只支持单张" : "复制这张"}</button>
              <button type="button" className="primary" onClick={() => void savePhotosToFolder(selectedPhotos)} disabled={photoAction !== null || !selectedPhotos.length}>{photoAction === "download" ? "正在保存…" : "保存所选到文件夹"}</button>
              {selectedPhotos.length > 0 && <button type="button" className="clear" onClick={() => setSelectedPhotoIds([])} disabled={photoAction !== null}>清空</button>}
            </div>
          </div>}
          {products.length === 0 ? <div className="empty catalog-empty"><b>图片库还是空的</b><p>去上传第一张商品图片吧。</p>{adminMode && <button onClick={() => setView("admin")}>去上传商品</button>}</div> :
          <div className="product-grid">{filtered.map((product, index) => {
            const order = orderFor(product);
            const photoSelected = selectedPhotoIds.includes(product.id);
            return <article className={`product-card ${photoSelected ? "photo-selected" : ""}`} key={product.id}>
              {product.image_key && <label className="photo-selector" onClick={(event) => event.stopPropagation()}>
                <input type="checkbox" checked={photoSelected} onChange={() => togglePhotoSelection(product.id)} />
                <span>{photoSelected ? "已选" : "选择"}</span>
              </label>}
              <button type="button" className={`product-image image-zoom ${palettes[index % palettes.length]}`} onClick={() => product.image_key && openLightbox(product)} disabled={!product.image_key} aria-label={product.image_key ? `放大查看${product.name}` : `${product.name}暂无图片`}>
                {product.image_key ? <img src={`/api/images/${product.image_key}`} alt={product.name} /> : <><span className="bag-shape">◡</span><small>暂无商品图片</small></>}
                <span className="sku">{product.sku}</span>
                {product.image_key && <span className="zoom-hint">点击放大</span>}
              </button>
              <div className="product-info">
                <div className="title-row"><div><h3>{product.name}</h3><p>{product.category} · {product.model || product.style || "箱包"}</p></div><label className="inline-price"><span>价格</span><span className="price-input"><i>¥</i><input type="number" min="0" step="0.01" value={priceDrafts[product.id] ?? (Number(product.price) > 0 ? String(product.price) : "")} placeholder="选填" disabled={savingPriceId === product.id} onChange={(event) => setPriceDrafts((current) => ({ ...current, [product.id]: event.target.value }))} onBlur={(event) => void saveProductPrice(product, event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /></span></label></div>
                <div className="meta"><span className="factory-tag">{product.factory || "未标厂家"}</span><span>{product.material || "材质待补充"}</span><span>{product.size || "尺寸待补充"}</span><span>{product.notes || "现货款"}</span></div>
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
        <div className="section-heading"><div><span className="eyebrow">PACKING LIST</span><h1>确认装箱单</h1><p>确认箱数和每箱数量后，按最新 PA 模板生成 Excel。</p></div><div className="order-summary"><span>{selected.length} 个款式</span><b>{totalCartons} 箱 / {totalPieces} 个</b>{hasPricedSelection && <strong>¥{totalAmount.toLocaleString("zh-CN", { minimumFractionDigits: 2 })}</strong>}</div></div>
        <div className="order-layout">
          <div className="order-list">{selected.length ? selected.map((product, index) => {
            const order = orderFor(product);
            return <div className="order-row carton-row" key={product.id}>
              <span className={`mini-image ${palettes[index % palettes.length]}`}>{product.image_key ? <img src={`/api/images/${product.image_key}`} alt="" /> : "AB"}</span>
              <div className="order-name"><b>{product.name}</b><small>{product.factory || "未标厂家"} · {product.sku} · {product.category}</small></div>
              <label className="compact-field"><span>箱数</span><input type="number" min="0" value={order.cartons} onChange={(event) => setOrder(product, { cartons: Math.max(0, Math.floor(Number(event.target.value) || 0)) })} /></label>
              <label className="compact-field"><span>每箱</span><select value={order.unitsPerCarton} onChange={(event) => setOrder(product, { unitsPerCarton: Number(event.target.value) })}>{packOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
              <div className="line-total"><small>{order.cartons * order.unitsPerCarton} 个</small>{Number(product.price) > 0 ? `¥${(order.cartons * order.unitsPerCarton * Number(product.price)).toFixed(2)}` : "未填价格"}</div>
            </div>;
          }) : <div className="empty"><b>订货单还是空的</b><p>先去商品选品页填写要订购的箱数。</p><button onClick={() => setView("catalog")}>去选商品</button></div>}</div>
          <aside className="customer-card"><h2>采购商资料</h2><label>采购商名称<input value={customer.name} onChange={(event) => setCustomer({ ...customer, name: event.target.value })} placeholder="将填写到模板的采购商栏" /></label><label>联系电话<input value={customer.phone} onChange={(event) => setCustomer({ ...customer, phone: event.target.value })} placeholder="将填写到模板的电话栏" /></label><div className="template-note"><b>严格使用最新 PA 模板</b><span>保留原表头、列宽、框线、公式和说明，并把商品图片写入“图片”列。</span></div><button className="export" onClick={exportExcel} disabled={exporting}>{exporting ? "正在生成含图片的 Excel…" : "下载 PA 格式 Excel"}<span>↓</span></button></aside>
        </div>
      </section>}

      {view === "admin" && <section className="admin-page">
        <div className="section-heading"><div><span className="eyebrow">BATCH UPLOAD</span><h1>按厂家批量上传</h1><p>选择厂家后一次上传多张照片，系统只自动识别照片画面中带 # 的数字货号。</p></div><div className="admin-note">手动货号可填写数字、字母或其他字符，系统统一在末尾加 #；同一厂家内不能重复。</div></div>
        <form className="product-form batch-product-form" noValidate onSubmit={submitProduct}>
          <div className={`image-upload ${uploadItems.length ? "has-image" : ""}`}>
            <input ref={imageInputRef} className="image-file-input" id="product-image-input" type="file" name="image" multiple accept="image/jpeg,image/png,image/webp" onChange={(event) => void chooseUploadFiles(Array.from(event.target.files ?? []))} />
            <button className="image-picker-trigger" type="button" onClick={() => imageInputRef.current?.click()}>
              {uploadItems.length ? <><img className="upload-preview" src={uploadItems[0].preview} alt="待上传商品预览" /><span className="change-image">重新选择</span><b>已选择 {uploadItems.length} 张照片</b><small>{uploadProgress || "可继续填写厂家和货号"}</small></> : <><span className="upload-plus">＋</span><b>一次选择多张商品照片</b><small>系统会自动识别照片里的数字#货号</small></>}
            </button>
          </div>
          <div className="form-fields batch-upload-fields">
            <div className="form-grid batch-common-fields">
              <label>厂家 *<input name="factory" list="factory-options" placeholder="必须填写，如 A厂、阿强厂" /><datalist id="factory-options">{factories.filter((factory) => factory !== "全部厂家" && factory !== "未标厂家").map((factory) => <option key={factory} value={factory} />)}</datalist></label>
              <label>箱包分类<input name="category" list="category-options" defaultValue="女包" /><datalist id="category-options">{suggestedCategories.map((category) => <option key={category} value={category} />)}</datalist></label>
              <label>每箱个数<select name="packingQuantity" defaultValue="100">{packOptions.map((option) => <option key={option} value={option}>{option} 个</option>)}</select></label>
              <label>共同备注<input name="notes" placeholder="选填，会应用到本批照片" /></label>
            </div>
            {uploadItems.length > 0 && <div className="batch-upload-list">{uploadItems.map((item, index) => <div className="batch-upload-item" key={item.id}>
              <button type="button" className="batch-preview-link" title="在当前页面放大核对货号" onClick={() => { setLightbox(null); setUploadPreview({ id: item.id, src: item.preview, label: `第 ${index + 1} 张待上传照片` }); setLightboxZoomed(false); }}><img src={item.preview} alt={`第 ${index + 1} 张待上传照片`} /></button>
              <div><b>{index + 1}. {item.file.name}</b><label>货号<input value={item.sku} maxLength={40} placeholder={item.recognizing ? "识别中，也可直接填写" : "填写货号"} onChange={(event) => updateUploadSku(item.id, event.target.value)} /></label><small>{item.recognizing && !item.sku ? "后台识别中，不用等待，可直接填写" : item.ocrNote || (item.sku ? `将保存为 ${item.sku}#` : "未识别到，请手动填写")}</small></div>
              <button type="button" className="batch-remove" onClick={() => removeUploadItem(item.id)} aria-label={`移除${item.file.name}`}>×</button>
            </div>)}</div>}
            <button className="save-product" disabled={loading}>{loading ? "正在批量保存…" : `保存 ${uploadItems.length || ""} 张照片`}</button>
          </div>
        </form>
        <div className="manage-list"><h2>已保存图片 <small>（{products.length}）</small></h2>{products.length ? products.map((product) => editingId === product.id ?
          <form className="manage-editor" key={product.id} onSubmit={(event) => updateProduct(event, product)}>
            <div className="editor-image">
              {product.image_key ? <button type="button" className="editor-thumb image-zoom" onClick={() => openLightbox(product)} title="在当前页面放大"><img src={`/api/images/${encodeURIComponent(product.image_key)}`} alt={product.name} /><span className="zoom-hint">页面内放大</span></button> : <div className="editor-thumb">暂无照片</div>}
              <label className="replace-photo">更换商品照片<input type="file" name="image" accept="image/jpeg,image/png,image/webp" /></label>
              <small>点击上方照片会在当前页面放大核对货号；不选择新照片则保留原照片</small>
            </div>
            <div className="editor-fields">
              <div className="form-grid">
                <label>工厂货号 *<input name="sku" required maxLength={40} defaultValue={product.sku.replace(/#$/, "")} placeholder="可填写数字、字母或其他字符" /></label><label>中文名称 *<input name="name" required defaultValue={product.name} /></label>
                <label>厂家 *<input name="factory" required list="factory-options" defaultValue={product.factory} /></label>
                <label>客人货号/型号<input name="model" defaultValue={product.model} /></label><label>款式<input name="style" defaultValue={product.style} /></label>
                <label>单价（选填）<input name="price" min="0" step="0.01" type="number" defaultValue={Number(product.price) || ""} /></label><label>箱包分类<input name="category" list="category-options" defaultValue={product.category || "女包"} /></label>
                <label>材质<input name="material" defaultValue={product.material} /></label><label>规格/尺寸<input name="size" defaultValue={product.size} /></label>
                <label>每箱数量<select name="packingQuantity" defaultValue={defaultPack(product)}>{packOptions.map((option) => <option key={option} value={option}>{option} 个</option>)}</select></label><label>单箱体积 m³<input name="cartonVolume" min="0" step="0.001" type="number" defaultValue={Number(product.carton_volume) || ""} /></label>
                <label>现有库存<input name="stock" min="0" type="number" defaultValue={product.stock} /></label>
              </div>
              <label>备注<textarea name="notes" defaultValue={product.notes} /></label>
              <div className="editor-actions"><button className="cancel-row" type="button" onClick={() => setEditingId(null)}>取消</button><button className="save-row" disabled={loading}>{loading ? "正在保存…" : "保存全部修改"}</button></div>
            </div>
          </form> :
          <div className="manage-product-summary" key={product.id}>
            {product.image_key ? <button type="button" className="manage-thumb image-zoom" onClick={() => openLightbox(product)} title="在当前页面放大"><img src={`/api/images/${encodeURIComponent(product.image_key)}`} alt={`放大查看${product.name}`} /></button> : <div className="manage-thumb">暂无照片</div>}
            <div className="manage-name"><b>{product.name}</b><small>{product.factory || "未标厂家"} · {product.sku} · {product.category}{Number(product.price) > 0 ? ` · ¥${Number(product.price).toFixed(2)}` : ""}</small></div>
            <button className="edit-row" onClick={() => setEditingId(product.id)}>编辑全部信息/更换照片</button><button className="delete-row" onClick={() => deleteProduct(product)}>删除商品</button>
          </div>) : <div className="manage-empty">还没有商品，请使用上方表单添加。</div>}</div>
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

      {selected.length > 0 && view === "catalog" && <button className="floating-order" onClick={() => setView("order")}><span><b>{selected.length}</b> 款 · {totalCartons} 箱 · {totalPieces} 个</span><strong>生成 Excel{hasPricedSelection ? `　¥${totalAmount.toFixed(2)}` : ""} →</strong></button>}
      {uploadPreview && previewUploadItem && <div className="lightbox" role="dialog" aria-modal="true" aria-label={`查看${uploadPreview.label}`} onClick={() => { setUploadPreview(null); setLightboxZoomed(false); }}>
        <div className="lightbox-panel" onClick={(event) => event.stopPropagation()}>
          <button type="button" className="lightbox-close" onClick={() => { setUploadPreview(null); setLightboxZoomed(false); }} aria-label="关闭大图">×</button>
          <div className={`lightbox-image-wrap ${lightboxZoomed ? "is-zoomed" : ""}`} role="button" tabIndex={0} aria-label={lightboxZoomed ? "缩小照片" : "放大照片到两倍"} onClick={() => setLightboxZoomed((current) => !current)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setLightboxZoomed((current) => !current); }}>
            <img src={uploadPreview.src} alt={uploadPreview.label} />
          </div>
          <div className="lightbox-actions quick-entry-actions">
            <div className="quick-sku-entry"><b>{uploadPreview.label}</b><label>货号<div><input autoFocus value={previewUploadItem.sku} maxLength={40} placeholder="数字、字母或其他字符" onChange={(event) => updateUploadSku(previewUploadItem.id, event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); advanceUploadPreview(); } }} /><span>#</span></div></label><small>{previewUploadItem.recognizing ? "后台仍在识别数字货号；可直接输入后按回车看下一张" : "输入货号后按回车，自动看下一张"}</small></div>
            <div className="lightbox-buttons"><button type="button" onClick={() => setLightboxZoomed((current) => !current)}>{lightboxZoomed ? "恢复大小" : "放大 2 倍"}</button><button type="button" onClick={advanceUploadPreview}>确认并看下一张 →</button><button type="button" onClick={() => { setUploadPreview(null); setLightboxZoomed(false); }}>返回列表</button></div>
          </div>
        </div>
      </div>}
      {lightbox?.image_key && <div className="lightbox" role="dialog" aria-modal="true" aria-label={`查看${lightbox.name}`} onClick={() => { setLightbox(null); setLightboxZoomed(false); }}>
        <div className="lightbox-panel" onClick={(event) => event.stopPropagation()}>
          <button type="button" className="lightbox-close" onClick={() => { setLightbox(null); setLightboxZoomed(false); }} aria-label="关闭大图">×</button>
          <div className={`lightbox-image-wrap ${lightboxZoomed ? "is-zoomed" : ""}`} role="button" tabIndex={0} aria-label={lightboxZoomed ? "缩小照片" : "放大照片到两倍"} onClick={() => setLightboxZoomed((current) => !current)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setLightboxZoomed((current) => !current); }}>
            <img src={`/api/images/${lightbox.image_key}`} alt={lightbox.name} />
          </div>
          <div className="lightbox-actions"><div><b>{lightbox.name}</b><small>{lightbox.sku} · 点击照片可{lightboxZoomed ? "缩小" : "放大到 2 倍"}</small></div><div className="lightbox-buttons"><button type="button" onClick={() => setLightboxZoomed((current) => !current)}>{lightboxZoomed ? "恢复大小" : "放大 2 倍"}</button><a href={`/api/images/${lightbox.image_key}`} download={`${lightbox.sku || lightbox.name}.${lightbox.image_key.split(".").pop() || "jpg"}`}>保存到电脑 ↓</a></div></div>
        </div>
      </div>}
      {notice && <button className="toast" onClick={() => setNotice("")}>{notice}<span>×</span></button>}
      <footer><span>{settings.brandName} · 私人商品图片库</span><small>仅店主账号可访问</small></footer>
    </main>
  );
}
