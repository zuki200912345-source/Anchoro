import type { NextConfig } from "next";

const projectRoot = process.cwd();

const nextConfig: NextConfig = {
  // The parent Downloads folder carries its own lockfile; pin the root so
  // Turbopack and file tracing do not infer it.
  turbopack: { root: projectRoot },
  outputFileTracingRoot: projectRoot,
};

export default nextConfig;
