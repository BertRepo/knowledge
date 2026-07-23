import type { NextConfig } from "next";

const isTauriBuild = process.env.TAURI_BUILD === "1";

const nextConfig: NextConfig = {
  // Tauri 打包时用静态导出（output: export），开发时用 standalone（Docker 用）。
  // TAURI_BUILD=1 时切到 export，产出 out/ 给 Tauri 打包。
  output: isTauriBuild ? "export" : "standalone",
  // 静态导出需要 base path 为空，图片不优化（export 不支持 next/image 的优化）
  images: isTauriBuild ? { unoptimized: true } : undefined,
};

export default nextConfig;
