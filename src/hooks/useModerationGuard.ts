// src/hooks/useModerationGuard.ts
'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { runModerationLite } from '@/utils/moderationLite';
import type { ModerationDecision } from '@/config/moderationconfig';
import {
  trackCheck,
  trackOverrideRequested,
  trackOverrideResult,
} from '@/telemetry/moderationTelemetry';
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

  const [decision, setDecision] = useState<ModerationDecision | null>(null);
  const [loading, setLoading] = useState(false);
  const [isReviewing, setIsReviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 🔥 ensure we warm up lite model once per hook usage
  const warmedUpRef = useRef(false);

  const run = useCallback(async () => {
    if (disabled) {
      setDecision(null);
      setLoading(false);
      setError(null);
      return;
    }

    const text = value.trim();
    if (!text) {
      setDecision(null);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const t0 = performance.now();
      let modDecision: ModerationDecision;

      // 1) Lite model first (local, WebWorker)
      if (flags.moderationLiteEnabled) {
        const lite = await runModerationLite(text);
        // ensure source is enforced to 'lite'
        modDecision = { ...lite, source: 'lite' };
      } else {
        // 2) If lite disabled, call backend directly
        const res = await fetch(overrideEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const backend = (await res.json()) as ModerationDecision;
        modDecision = { ...backend, source: 'backend' };
      }

      setDecision(modDecision);

      if (flags.moderationTelemetryEnabled) {
        trackCheck({
          label: modDecision.label,
          action: normalizeAction(modDecision),
          source: (modDecision.source as 'lite' | 'backend') ?? 'lite',
          latency_ms: Math.round(performance.now() - t0),
          text_len: text.length,
        });
      }
    } catch {
      // Lite failed → backend fallback once
      try {
        const t0 = performance.now();
        const res = await fetch(overrideEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: value.trim() }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const backend = (await res.json()) as ModerationDecision;
        const decisionWithSource: ModerationDecision = {
          ...backend,
          source: 'backend',
        };

        setDecision(decisionWithSource);

        if (flags.moderationTelemetryEnabled) {
          trackCheck({
            label: decisionWithSource.label,
            action: normalizeAction(decisionWithSource),
            source: 'backend',
            latency_ms: Math.round(performance.now() - t0),
            text_len: text.length,
          });
        }
      } catch (err: any) {
        console.error('[useModerationGuard] backend fallback failed', err);
        setError(err?.message ?? 'Moderation fallback failed');
      }
    } finally {
      setLoading(false);
    }
  }, [value, overrideEndpoint, flags, disabled]);

  // ⏱ live/debounced checks (unchanged)
  useEffect(() => {
    if (!live) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(run, debounceMs);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [value, run, debounceMs, live]);

  // 🌡 warm up lite model once on mount when enabled
  useEffect(() => {
    if (warmedUpRef.current) return;
    if (!flags.moderationEnabled || !flags.moderationLiteEnabled) return;

    warmedUpRef.current = true;
    // small dummy text just to trigger worker + model load
    runModerationLite('warmup').catch((err) => {
      console.warn('[useModerationGuard] lite warmup failed', err);
    });
  }, [flags.moderationEnabled, flags.moderationLiteEnabled]);

  const requestReview = async () => {
    if (disabled || !flags.moderationOverrideEnabled) return;
    if (!decision || (decision.action !== 'warn' && decision.action !== 'block')) return;

    const text = value.trim();
    if (!text) return;

    setIsReviewing(true);
    setError(null);
    try {
      if (flags.moderationTelemetryEnabled) {
        trackOverrideRequested(decision.label);
      }

      const res = await fetch(overrideEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, clientDecision: decision }),
      });
      if (!res.ok) throw new Error('Review failed');

      const override = (await res.json()) as ModerationDecision;
      const overrideWithSource: ModerationDecision = {
        ...override,
        source: 'backend',
      };
      setDecision(overrideWithSource);

      const approved = overrideWithSource.action !== 'block';
      if (flags.moderationTelemetryEnabled) {
        trackOverrideResult(approved ? 'approved' : 'rejected', overrideWithSource.label);
      }
    } catch (e: any) {
      console.error('[useModerationGuard] review failed', e);
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
