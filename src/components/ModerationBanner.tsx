// src/components/ModerationBanner.tsx
'use client';

import type { ModerationDecision } from '@/config/moderationconfig';
import clsx from 'clsx';
import { useFeatureFlags } from '@/providers/featureFlagProvider';

interface Props {
  decision: ModerationDecision;
  onRequestReview?: () => void;
  isReviewing?: boolean;
}

export function ModerationBanner({ decision, onRequestReview, isReviewing }: Readonly<Props>) {
  const flags = useFeatureFlags();

  if (!flags.moderationEnabled) return null;
  if (decision.action === 'allow') return null;

  const isBlock = decision.blocked;
  //const score = (decision.scores[decision.label] * 100).toFixed(1);
  const isLite = decision.source === 'lite';

  const mainLabel = isBlock ? 'BLOCKED' : 'WARNING';

  const idleButtonLabel = isLite ? 'Request review' : 'Recheck';
  const busyButtonLabel = isLite ? 'Reviewing…' : 'Rechecking…';

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={clsx(
        'rounded-lg p-4 flex items-center justify-between',
        isBlock
          ? 'bg-red-100 border border-red-400 text-red-800'
          : 'bg-amber-100 border border-amber-400 text-amber-800'
      )}
    >
      <div className="flex items-center gap-2">
        <strong>{mainLabel}</strong>:

        <span className="text-xs opacity-70">[{decision.source}]</span>
      </div>

      {onRequestReview && (decision.action === 'warn' || decision.action === 'block') && (
        <button
          type="button"
          onClick={onRequestReview}
          disabled={isReviewing}
          aria-disabled={isReviewing ? 'true' : 'false'}
          aria-label={
            isReviewing
              ? `${idleButtonLabel} in progress`
              : `${idleButtonLabel} for this moderated content`
          }
          className={clsx(
            'ml-4 px-3 py-1 text-sm font-medium rounded transition',
            isReviewing
              ? isBlock
                ? 'bg-red-300 text-red-800 cursor-wait'
                : 'bg-amber-300 text-amber-700 cursor-wait'
              : isBlock
              ? 'bg-red-600 text-white hover:bg-red-700'
              : 'bg-amber-600 text-white hover:bg-amber-700'
          )}
        >
          {isReviewing ? busyButtonLabel : idleButtonLabel}
        </button>
      )}
    </div>
  );
}
