// src/pages/_app.tsx
import type { AppProps } from 'next/app';
import { FeatureFlagProvider } from '@/providers/featureFlagProvider';
import '@/styles/globals.css';

export default function MyApp({ Component, pageProps }: AppProps) {
  return (
    <FeatureFlagProvider>
      <Component {...pageProps} />
    </FeatureFlagProvider>
  );
}
