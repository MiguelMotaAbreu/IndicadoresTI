import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  experimental: {
    agentFeedback: true,
    optimizePackageImports: ["@phosphor-icons/react", "recharts"],
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: [
          {
            loader: "@tailwindcss/turbopack",
            options: {
              base: path.join(process.cwd(), "app"),
            },
          },
        ],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
