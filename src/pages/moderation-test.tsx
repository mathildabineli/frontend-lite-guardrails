// src/pages/moderation-test.tsx
'use client';

import { useState } from 'react';
import clsx from 'clsx';
import { ModerationBanner } from '@/components/ModerationBanner';
import { useModerationGuard } from '@/hooks/useModerationGuard';
import { useFeatureFlags } from '@/providers/featureFlagProvider';

export default function ModerationTestPage() {
  const flags = useFeatureFlags();
  const [input, setInput] = useState('');

  const {
    decision,
    loading,
    isBlocked,
    isReviewing,
    showReview,
    error,
    requestReview,
  } = useModerationGuard(input, {
    live: true,
    debounceMs: 120, // tighter for near-realtime
    overrideEndpoint: '/api/moderation/check',
  });

  const canSubmit = !isBlocked;

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 py-12 px-4">
      <div className="max-w-2xl mx-auto space-y-8">
        <header className="text-center space-y-2">
          <h1 className="text-3xl font-bold text-slate-900">
            Frontend Lite Guardrails – Demo
          </h1>
          <p className="text-slate-600">
            Real-time moderation with inline warnings and override flow.
          </p>

          {/* Small flag status badge for debugging / visibility */}
          <p className="text-xs text-slate-500">
            Moderation:{' '}
            <span className={flags.moderationEnabled ? 'text-emerald-600' : 'text-red-600'}>
              {flags.moderationEnabled ? 'enabled' : 'disabled'}
            </span>{' '}
            · Lite model:{' '}
            <span className={flags.moderationLiteEnabled ? 'text-emerald-600' : 'text-slate-500'}>
              {flags.moderationLiteEnabled ? 'on' : 'off'}
            </span>{' '}
            · Telemetry:{' '}
            <span className={flags.moderationTelemetryEnabled ? 'text-emerald-600' : 'text-slate-500'}>
              {flags.moderationTelemetryEnabled ? 'on' : 'off'}
            </span>
          </p>
        </header>

        <div className="space-y-3">
          <label className="block text-sm font-medium text-slate-700">
            Research Query / Comment
          </label>

          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={4}
            placeholder="Type your query or comment..."
            className={clsx(
              'w-full rounded-xl border p-4 text-slate-800 placeholder-slate-400 shadow-sm transition-all',
              isBlocked
                ? 'border-red-500 bg-red-50 focus:border-red-600 focus:ring-red-500/20'
                : decision?.action === 'warn'
                ? 'border-amber-500 bg-amber-50 focus:border-amber-600 focus:ring-amber-500/20'
                : 'border-slate-300 bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20'
            )}
          />

          {/* Non-blocking status */}
          {loading && <p className="text-xs text-slate-500">Checking…</p>}

          {/* Inline banner */}
          {decision && (
            <ModerationBanner
              decision={decision}
              onRequestReview={showReview ? requestReview : undefined}
              isReviewing={isReviewing}
            />
          )}

          {/* Error */}
          {error && <p className="text-xs text-red-600">{error}</p>}

          {!flags.moderationEnabled && (
            <p className="text-xs text-slate-500">
              Moderation is currently disabled via feature flags — all inputs are allowed.
            </p>
          )}
        </div>

        {/* Submit */}
        <button
          onClick={() => alert('Submitted!')}
          disabled={!canSubmit}
          className={clsx(
            'w-full rounded-lg px-5 py-3 font-medium transition-all',
            canSubmit
              ? 'bg-green-600 text-white hover:bg-green-700 active:scale-95'
              : 'bg-slate-200 text-slate-500 cursor-not-allowed'
          )}
        >
          {isBlocked ? 'Blocked' : 'Submit'}
        </button>

        {/* Debug */}
        {decision && (
          <details className="text-xs text-slate-500">
            <summary className="cursor-pointer font-medium hover:text-slate-700">
              Debug Decision
            </summary>
            <pre className="mt-2 p-3 bg-slate-100 rounded-lg overflow-x-auto text-xs">
              {JSON.stringify(decision, null, 2)}
            </pre>
          </details>
        )}
      </div>
    </main>
  );
}
