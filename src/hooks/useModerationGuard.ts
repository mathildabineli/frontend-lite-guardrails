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

interface Options {
  debounceMs?: number;
  live?: boolean;
  overrideEndpoint?: string;
}

// NEW: clamp any custom action (like "fallback") to the 3 telemetry buckets
function normalizeAction(d: ModerationDecision): 'allow' | 'warn' | 'block' {
  if (d.blocked) return 'block';
  if (d.action === 'warn' || d.shouldRequestReview) return 'warn';
  return 'allow';
}

/** Guard flow: lite → (fallback) backend → optional review */
export function useModerationGuard(
  value: string,
  { debounceMs = 300, live = true, overrideEndpoint = '/api/moderation/check' }: Options = {}
) {
  const [decision, setDecision] = useState<ModerationDecision | null>(null);
  const [loading, setLoading] = useState(false);
  const [isReviewing, setIsReviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const run = useCallback(async () => {
    const text = value.trim();
    if (!text) {
      setDecision(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // 1) Lite
      const t0 = performance.now();
      const lite = await runModerationLite(text);
      setDecision(lite);

      trackCheck({
        label: lite.label,
        action: normalizeAction(lite),             // ← normalize here
        source: (lite.source as 'lite' | 'backend') ?? 'lite',
        latency_ms: Math.round(performance.now() - t0),
        text_len: text.length,
      });
    } catch {
      // 2) Backend fallback
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

        trackCheck({
          label: backend.label,
          action: normalizeAction(backend),        // ← and here
          source: (backend.source as 'lite' | 'backend') ?? 'backend',
          latency_ms: Math.round(performance.now() - t0),
          text_len: text.length,
        });
      } catch (err: any) {
        setError(err?.message ?? 'Moderation fallback failed');
      }
    } finally {
      setLoading(false);
    }
  }, [value, overrideEndpoint]);

  useEffect(() => {
    if (!live) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(run, debounceMs);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [value, run, debounceMs, live]);

  const requestReview = async () => {
    if (!decision || (decision.action !== 'warn' && decision.action !== 'block')) return;
    setIsReviewing(true);
    setError(null);
    try {
      trackOverrideRequested(decision.label);
      const res = await fetch(overrideEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: value.trim(), clientDecision: decision }),
      });
      if (!res.ok) throw new Error('Review failed');
      const override = (await res.json()) as ModerationDecision;
      setDecision(override);

      const approved = override.action !== 'block';
      trackOverrideResult(approved ? 'approved' : 'rejected', override.label);
    } catch (e: any) {
      setError(e?.message ?? 'Review failed');
      trackOverrideResult('error', decision.label);
    } finally {
      setIsReviewing(false);
    }
  };

  const isBlocked = decision?.blocked ?? false;
  const showReview = decision?.action === 'warn' || decision?.action === 'block';

  return { decision, loading, isBlocked, isReviewing, showReview, error, runCheck: run, requestReview };
}
