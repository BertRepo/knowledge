import type { MetadataRoute } from "next";

// 本地工具默认不希望被搜索引擎收录；若部署为公开站点，把 disallow 改成空或具体路径。
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", disallow: "/" },
    sitemap: "http://localhost:3000/sitemap.xml",
  };
}
