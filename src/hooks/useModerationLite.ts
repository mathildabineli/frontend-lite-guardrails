// src/hooks/useModerationLite.ts
import { useState, useEffect } from 'react';
import { runModerationLite } from '@/utils/moderationLite';
import {
  MODERATION_LABELS,
  type ModerationDecision,
  type ModerationLabel,
} from '@/config/moderationconfig';

export function useModerationLite(text: string) {
  const [decision, setDecision] = useState<ModerationDecision | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!text.trim()) {
      const emptyScores = Object.fromEntries(
        MODERATION_LABELS.map(label => [label, label === 'safe' ? 1 : 0])
      ) as Record<ModerationLabel, number>;

      setDecision({
        label: 'safe',
        scores: emptyScores,
        action: 'allow',
        blocked: false,
        shouldRequestReview: false,
        reason: 'empty input',
        source: 'lite',
      });
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const lite = await runModerationLite(text);
        if (!cancelled) setDecision(lite);
      } catch {
        // Fallback to backend
        try {
          const res = await fetch('/api/moderation/check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text }),
          });
          const backend = await res.json();
          if (!cancelled) setDecision(backend);
        } catch {
          if (!cancelled) setError('Moderation check failed');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [text]);

  return { decision, loading, error };
}
