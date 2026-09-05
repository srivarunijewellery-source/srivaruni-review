import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ffmpeg-static ships a binary; make sure Vercel bundles it with the scan function.
  serverExternalPackages: ["sharp", "ffmpeg-static"],
  outputFileTracingIncludes: {
    "/api/scan": ["./node_modules/ffmpeg-static/ffmpeg"],
  },
};

export default nextConfig;
