// next.config.ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactCompiler: true,
  reactStrictMode: true,
  webpack: (config, { isServer }) => {
    // Only for the browser bundle
    if (!isServer) {
      config.resolve = config.resolve || {};
      config.resolve.alias = {
        ...(config.resolve.alias || {}),
        // Prevent server-only packages from being pulled into the browser
        'onnxruntime-node$': false,
        'sharp$': false,
      };
    }
    return config;
  },
  turbopack: {},
};

export default nextConfig;
