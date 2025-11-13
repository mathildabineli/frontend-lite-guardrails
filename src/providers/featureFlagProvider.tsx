// src/providers/FeatureFlagProvider.tsx
'use client';
import { createContext, useContext, useState, ReactNode, useEffect } from 'react';
import { defaultFlags, type FeatureFlags } from '@/config/featureFlagsconfig';

const FeatureFlagContext = createContext<FeatureFlags>(defaultFlags);

// tiny stable hash → 0..99
function hashBucket(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) % 100;
}

// stable per-session id (no PII)
function getSessionId(): string {
  try {
    const k = 'ts_sid';
    const existing = sessionStorage.getItem(k);
    if (existing) return existing;
    const v = Math.random().toString(36).slice(2) + Date.now().toString(36);
    sessionStorage.setItem(k, v);
    return v;
  } catch {
    return 'anon';
  }
}

const rolloutPct = Number(
  process.env.NEXT_PUBLIC_ROLLOUT_MODERATION_PERCENT ?? '0'
); // 0..100

export function FeatureFlagProvider({ children }: { children: ReactNode }) {
  const [flags, setFlags] = useState<FeatureFlags>(defaultFlags);

  useEffect(() => {
    // Base from env/defaults
    let f = { ...defaultFlags };

    // Cohort bucketing for gradual rollout
    const sid = getSessionId();
    const bucket = hashBucket(sid); // 0..99
    const inRollout = bucket < rolloutPct;

    // If user falls in rollout cohort, enable the feature(s)
    if (inRollout) {
      f.moderationEnabled = true;
      // Optionally force sub-gates on during rollout:
      // f.moderationLiteEnabled = true;
      // f.moderationTelemetryEnabled = true;
      // f.moderationOverrideEnabled = true;
    } else {
      // Optionally hard-off outside cohort (keeps gradual rollout honest)
      f.moderationEnabled = false;
    }

    setFlags(f);

    // (Optional) expose for quick debugging in dev
    if (process.env.NODE_ENV !== 'production') {
      (window as any).__flags = { bucket, rolloutPct, flags: f };
      // console.log('Feature flags', { bucket, rolloutPct, flags: f });
    }
  }, []);

  return (
    <FeatureFlagContext.Provider value={flags}>
      {children}
    </FeatureFlagContext.Provider>
  );
}

export function useFeatureFlags() {
  return useContext(FeatureFlagContext);
}
