import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const base = new URL(`${protocol}://${host}`);
  return {
    metadataBase: base,
    title: "阿斌皮具｜线上选品与订货",
    description: "女包商品选品、数量填写与一键生成 Excel 订货单。",
    openGraph: { title: "阿斌皮具｜线上选品 · 快速订货", description: "选款、填数量，一键生成 Excel。", images: [new URL("/og.png", base).toString()] },
    twitter: { card: "summary_large_image", title: "阿斌皮具｜线上选品 · 快速订货", description: "选款、填数量，一键生成 Excel。", images: [new URL("/og.png", base).toString()] },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
