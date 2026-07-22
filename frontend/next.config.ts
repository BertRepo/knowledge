import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produce a self-contained `.next/standalone` for the Docker image.
  // Ignored by `next dev`; only affects `next build`.
  output: "standalone",
};

export default nextConfig;
