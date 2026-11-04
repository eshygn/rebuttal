import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  // Evidence images and recorded AI runs are read from disk at runtime.
  outputFileTracingIncludes: { "/**": ["./public/evidence/**", "./src/lib/ai/recorded/**", "./fixtures/**"] },
};

export default nextConfig;
