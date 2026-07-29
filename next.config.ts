import type { NextConfig } from "next";

// Static, client-only export for GitHub Pages (decision 11). basePath is empty
// locally (so `npm run dev` and a plain `serve out` work at the root) and set to
// `/<repo>` in CI, since project Pages are served from a sub-path.
const basePath = process.env.BASE_PATH ?? "";

const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  trailingSlash: true,
  basePath,
};

export default nextConfig;
