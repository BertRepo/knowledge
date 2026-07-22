import type { MetadataRoute } from "next";

// 本地工具只有首页与设置页两个公开路由；部署为公开站点时按需补充。
export default function sitemap(): MetadataRoute.Sitemap {
  const base = "http://localhost:3000";
  return [
    { url: `${base}/`, lastModified: new Date(), changeFrequency: "weekly", priority: 1 },
    { url: `${base}/settings`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.3 },
  ];
}
