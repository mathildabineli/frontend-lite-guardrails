// src/hooks/useModerationGuard.ts
'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { runModerationLite } from '@/utils/moderationLite';
import type { ModerationDecision } from '@/config/moderationconfig';
import { trackCheck, trackOverrideRequested, trackOverrideResult } from '@/telemetry/moderationTelemetry';
import { useFeatureFlags } from '@/providers/featureFlagProvider';

interface Options {
  debounceMs?: number;
  live?: boolean;
  overrideEndpoint?: string;
}

// Normalize to 3 buckets for telemetry
function normalizeAction(d: ModerationDecision): 'allow' | 'warn' | 'block' {
  if (d.blocked) return 'block';
  if (d.action === 'warn' || d.shouldRequestReview) return 'warn';
  return 'allow';
}

export function useModerationGuard(
  value: string,
  { debounceMs = 300, live = true, overrideEndpoint = '/api/moderation/check' }: Options = {}
) {
  const flags = useFeatureFlags();
  const disabled = !flags.moderationEnabled;

  console.log('feature flags in hook', flags)

  // ⬇️ Hooks must be declared unconditionally
  const [decision, setDecision] = useState<ModerationDecision | null>(null);
  const [loading, setLoading] = useState(false);
  const [isReviewing, setIsReviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const run = useCallback(async () => {
    if (disabled) {
      // When disabled, present a pass-through state
      setDecision(null);
      setLoading(false);
      setError(null);
      return;
    }

    const text = value.trim();
    if (!text) {
      setDecision(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const t0 = performance.now();
      let modDecision: ModerationDecision;
      let source: 'lite' | 'backend' = 'lite';

      if (flags.moderationLiteEnabled) {
        modDecision = await runModerationLite(text);
      } else {
        const res = await fetch(overrideEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        modDecision = (await res.json()) as ModerationDecision;
        source = 'backend';
      }

      setDecision(modDecision);

      if (flags.moderationTelemetryEnabled) {
        trackCheck({
          label: modDecision.label,
          action: normalizeAction(modDecision),
          source: (modDecision.source as 'lite' | 'backend') ?? source,
          latency_ms: Math.round(performance.now() - t0),
          text_len: text.length,
        });
      }
    } catch {
      // Backend fallback if lite failed
      try {
        const t0 = performance.now();
        const res = await fetch(overrideEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const backend = (await res.json()) as ModerationDecision;
        setDecision(backend);

        if (flags.moderationTelemetryEnabled) {
          trackCheck({
            label: backend.label,
            action: normalizeAction(backend),
            source: (backend.source as 'lite' | 'backend') ?? 'backend',
            latency_ms: Math.round(performance.now() - t0),
            text_len: text.length,
          });
        }
      } catch (err: any) {
        setError(err?.message ?? 'Moderation fallback failed');
      }
    } finally {
      setLoading(false);
    }
  }, [value, overrideEndpoint, flags, disabled]);

  useEffect(() => {
    if (!live) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(run, debounceMs);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [value, run, debounceMs, live]);

  const requestReview = async () => {
    if (disabled || !flags.moderationOverrideEnabled) return;
    if (!decision || (decision.action !== 'warn' && decision.action !== 'block')) return;

    setIsReviewing(true);
    setError(null);
    try {
      if (flags.moderationTelemetryEnabled) {
        trackOverrideRequested(decision.label);
      }
      const res = await fetch(overrideEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: value.trim(), clientDecision: decision }),
      });
      if (!res.ok) throw new Error('Review failed');
      const override = (await res.json()) as ModerationDecision;
      setDecision(override);

      const approved = override.action !== 'block';
      if (flags.moderationTelemetryEnabled) {
        trackOverrideResult(approved ? 'approved' : 'rejected', override.label);
      }
    } catch (e: any) {
      setError(e?.message ?? 'Review failed');
      if (flags.moderationTelemetryEnabled) {
        trackOverrideResult('error', decision.label);
      }
    } finally {
      setIsReviewing(false);
    }
  };

  const isBlocked = decision?.blocked ?? false;
  const showReview = decision?.action === 'warn' || decision?.action === 'block';

  return {
    decision,
    loading,
    isBlocked,
    isReviewing,
    showReview,
    error,
    runCheck: run,
    requestReview,
  };
}
