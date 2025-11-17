
// src/components/ModerationBanner.tsx
'use client';

import type { ModerationDecision, ModerationLabel } from '@/config/moderationconfig';
import clsx from 'clsx';
import { useFeatureFlags } from '@/providers/featureFlagProvider';

interface Props {
  decision: ModerationDecision;
  onRequestReview?: () => void;
  isReviewing?: boolean;
}

export function ModerationBanner({
  decision,
  onRequestReview,
  isReviewing,
}: Readonly<Props>) {
  const flags = useFeatureFlags();
  if (!flags.moderationEnabled) return null;
  if (decision.action === 'allow') return null;

  const isBlock = decision.blocked;
  const isLite = decision.source === 'lite';

  const mainLabel = isBlock ? 'Blocked' : 'Warning';
  const idleButtonLabel = isLite ? 'Request review' : 'Recheck';
  const busyButtonLabel = isLite ? 'Reviewing…' : 'Rechecking…';

  const predictedLabel = decision.label as ModerationLabel;
  const prettyCategory = predictedLabel.replace(/-/g, ' '); // e.g. "not-toxic" → "not toxic"

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={clsx(
        'flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-xs sm:text-sm shadow-sm',
        isBlock
          ? 'bg-red-50 border-red-200 text-red-800'
          : 'bg-amber-50 border-amber-200 text-amber-800',
      )}
    >
      <div className="flex items-center gap-2 min-w-0">
      

        <div className="flex flex-col min-w-0">
          <span className="font-semibold truncate">
            {mainLabel}
            <span className="ml-1 text-[10px] uppercase tracking-wide opacity-60">
              
            </span>
          </span>
          <span className="text-[11px] sm:text-xs truncate">
            
            <span className="font-medium">{prettyCategory}</span>
          </span>
        </div>
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
            'shrink-0 rounded-full px-3 py-1 text-[11px] font-medium transition',
            isReviewing
              ? 'bg-slate-200 text-slate-500 cursor-wait'
              : isBlock
              ? 'bg-red-600 text-white hover:bg-red-700'
              : 'bg-amber-600 text-white hover:bg-amber-700',
          )}
        >
          {isReviewing ? busyButtonLabel : idleButtonLabel}
        </button>
      )}
    </div>
  );
}
