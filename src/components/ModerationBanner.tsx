// src/components/ModerationBanner.tsx
import type { ModerationDecision } from '@/config/moderationconfig';
import clsx from 'clsx';

interface Props {
  decision: ModerationDecision;
  onRequestReview?: () => void;
  isReviewing?: boolean;
}

export function ModerationBanner({ decision, onRequestReview, isReviewing }: Props) {
  if (decision.action === 'allow') return null;

  const isBlock = decision.blocked;
  const score = (decision.scores[decision.label] * 100).toFixed(1);

  return (
    <div
      className={clsx(
        'rounded-lg p-4 flex items-center justify-between',
        isBlock
          ? 'bg-red-100 border border-red-400 text-red-800'
          : 'bg-amber-100 border border-amber-400 text-amber-800'
      )}
    >
      <div className="flex items-center gap-2">
        <strong>{isBlock ? 'BLOCKED' : 'WARNING'}</strong>:
        <span>{decision.label} ({score}%)</span>
        <span className="text-xs opacity-70">[{decision.source}]</span>
      </div>

      {!isBlock && onRequestReview && (
        <button
          onClick={onRequestReview}
          disabled={isReviewing}
          className={clsx(
            'ml-4 px-3 py-1 text-sm font-medium rounded transition',
            isReviewing
              ? 'bg-amber-300 text-amber-700 cursor-wait'
              : 'bg-amber-600 text-white hover:bg-amber-700'
          )}
        >
          {isReviewing ? 'Reviewing…' : 'Request review'}
        </button>
      )}
    </div>
  );
}
