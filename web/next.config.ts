import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["postgres", "unpdf", "mammoth", "bcryptjs"],
  experimental: {
    // Uploads can be sizeable; allow generous bodies on server actions.
    serverActions: { bodySizeLimit: "32mb" },
  },
};

export default nextConfig;
