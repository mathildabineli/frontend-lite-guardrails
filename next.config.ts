// next.config.ts
import type { NextConfig } from 'next';
const nextConfig: NextConfig = {
  // ⚠ Next 15 doesn’t know `reactCompiler` yet, that’s why you see the warning.
  // If the repo insists on it, you can keep it; otherwise you can remove it.
  // reactCompiler: true,
  reactStrictMode: true,
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // Ensure resolve exists
      config.resolve = config.resolve || {};
      config.resolve.alias = {
        ...(config.resolve.alias || {}),
        // Don’t ever bundle the Node runtime version in the browser
        'onnxruntime-node$': false,
        // Prevent sharp from being pulled into client chunks
        sharp: false,
        // If some lib tries to import 'fs', make it a no-op
        fs: false,
      };
    }
    return config;
  },
  turbopack: {},
};
export default nextConfig;