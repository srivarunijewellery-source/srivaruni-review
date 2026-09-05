import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @ffmpeg-installer ships the binary as a plain file (no postinstall download); bundle it with both video routes.
  serverExternalPackages: ["sharp", "@ffmpeg-installer/ffmpeg"],
  outputFileTracingIncludes: {
    "/api/scan": ["./node_modules/@ffmpeg-installer/linux-x64/**"],
    "/api/import": ["./node_modules/@ffmpeg-installer/linux-x64/**"],
  },
};

export default nextConfig;
