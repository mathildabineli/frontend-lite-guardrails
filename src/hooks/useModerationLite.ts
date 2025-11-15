// src/hooks/useModerationLite.ts
import { useState, useEffect } from 'react';
import { runModerationLite } from '@/utils/moderationLite';
import {
  type ModerationDecision,
  type ModerationLabel,
  getActiveLiteModelConfig,
} from '@/config/moderationconfig';
import { useFeatureFlags } from '@/providers/featureFlagProvider';

const cfg = getActiveLiteModelConfig();

function makeSafeDecision(reason: string): ModerationDecision {
  if (!cfg) {
    return {
      label: 'safe',
      scores: {},
      action: 'allow',
      blocked: false,
      shouldRequestReview: false,
      reason,
      source: 'lite',
    };
  }

  const scores: Record<ModerationLabel, number> = {};
  const safeLabel = cfg.safeLabels[0];

  for (const label of cfg.labels) {
    scores[label as ModerationLabel] = label === safeLabel ? 1 : 0;
  }

  return {
    label: (safeLabel as ModerationLabel) ?? ('safe' as ModerationLabel),
    scores,
    action: 'allow',
    blocked: false,
    shouldRequestReview: false,
    reason,
    source: 'lite',
  };
}

export function useModerationLite(text: string) {
  const flags = useFeatureFlags();
  const [decision, setDecision] = useState<ModerationDecision | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!flags.moderationEnabled || !flags.moderationLiteEnabled) {
      setDecision(makeSafeDecision('moderation disabled'));
      setLoading(false);
      setError(null);
      return;
    }

    if (!text.trim()) {
      setDecision(makeSafeDecision('empty input'));
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        // 1) Try lite model
        const lite = await runModerationLite(text);
        if (!cancelled) {
          setDecision({ ...lite, source: 'lite' });
        }
      } catch (err) {
        // 2) Fallback to backend full model
        try {
          const res = await fetch('/api/moderation/check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text }),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const backend = (await res.json()) as ModerationDecision;
          if (!cancelled) {
            setDecision({ ...backend, source: 'backend' });
          }
        } catch (e) {
          if (!cancelled) {
            console.error('[useModerationLite] backend fallback failed', e);
            setError('Moderation check failed');
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [text, flags]);

  return { decision, loading, error };
}
