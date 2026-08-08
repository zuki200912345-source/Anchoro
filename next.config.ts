import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // The parent Downloads folder carries its own lockfile; pin the root so
  // Turbopack and file tracing do not infer it.
  turbopack: { root: path.resolve(__dirname) },
  outputFileTracingRoot: path.resolve(__dirname),
};

export default nextConfig;
