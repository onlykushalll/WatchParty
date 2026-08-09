import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: false,
  // Allow the Cloudflare tunnel subdomain to access the dev server.
  allowedDevOrigins: [
    "wp.kushalneedsmcp.online",
    "https://wp.kushalneedsmcp.online",
    "kushalneedsmcp.online",
    "focus.kushalneedsmcp.online",
    "examiner.kushalneedsmcp.online",
  ],
};

export default nextConfig;
