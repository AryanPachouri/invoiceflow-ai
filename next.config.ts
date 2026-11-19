import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Native / WASM packages must be loaded from node_modules at runtime, not bundled.
  serverExternalPackages: ["@electric-sql/pglite", "pg", "tesseract.js", "@tesseract.js-data/eng", "@napi-rs/canvas", "unpdf", "pdfjs-dist"],
  outputFileTracingIncludes: {
    "/api/**/*": [
      "./db/migrations/**/*",
      "./db/seed-invoices/**/*",
      "./node_modules/@tesseract.js-data/eng/4.0.0_best_int/**/*",
      "./node_modules/tesseract.js-core/**/*",
      "./node_modules/@electric-sql/pglite/dist/**/*",
    ],
  },
  // Never ship local runtime data (embedded DB, uploads) inside the build.
  outputFileTracingExcludes: { "*": ["./.data/**/*", "./scratch/**/*", "./tests/**/*"] },
  poweredByHeader: false,
};

export default nextConfig;
