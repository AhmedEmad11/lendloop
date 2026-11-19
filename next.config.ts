import type { NextConfig } from "next";

// All app data is loaded client-side through Convex subscriptions, so the
// cacheComponents / partial prefetching defaults from the scaffold add no value
// and conflict with Clerk's dynamic provider. Kept off for simplicity.
const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
