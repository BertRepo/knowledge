import type { MetadataRoute } from "next";

// 本地工具默认不希望被搜索引擎收录；若部署为公开站点，把 disallow 改成空或具体路径。
// Tauri 打包（静态导出）不需要 robots，force-static 避免导出报错。
export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", disallow: "/" },
    sitemap: "http://localhost:3000/sitemap.xml",
  };
}
