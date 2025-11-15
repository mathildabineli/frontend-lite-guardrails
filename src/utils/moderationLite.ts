// src/utils/moderationLite.ts
import {
  type ModerationDecision,
  type ModerationLabel,
  getActiveLiteModelConfig,
} from '@/config/moderationconfig';

let worker: Worker | null = null;

// Resolve active lite model once (at build/runtime)
const activeLiteConfig = getActiveLiteModelConfig();

function getWorker() {
  if (!worker) {
    worker = new Worker(
      new URL('../worker/moderationWorker.ts', import.meta.url),
      { type: 'module' },
    );
  }
  return worker;
}

function makeSafeScores(): Record<ModerationLabel, number> {
  if (!activeLiteConfig) return {};
  const scores: Record<ModerationLabel, number> = {} as any;
  const safeLabel = activeLiteConfig.safeLabels[0];

  for (const label of activeLiteConfig.labels) {
    scores[label as ModerationLabel] =
      label === safeLabel ? 1 : 0;
  }
  return scores;
}

let nextRequestId = 1;
let hasLiteLoadedOnce = false; // 👈 track warmup completion

export async function runModerationLite(
  text: string,
): Promise<ModerationDecision> {
  // If no model config, just always allow
  if (!activeLiteConfig) {
    return {
      label: 'safe',
      scores: {},
      action: 'allow',
      blocked: false,
      shouldRequestReview: false,
      reason: 'no lite model config',
      source: 'lite',
    };
  }

  const trimmed = text.trim();
  if (!trimmed) {
    return {
      label: (activeLiteConfig.safeLabels[0] ??
        'safe') as ModerationLabel,
      scores: makeSafeScores(),
      action: 'allow',
      blocked: false,
      shouldRequestReview: false,
      reason: 'empty input',
      source: 'lite',
    };
  }

  const w = getWorker();
  const requestId = nextRequestId++;

  return new Promise<ModerationDecision>((resolve, reject) => {
    const handleMessage = (e: MessageEvent) => {
      const d = e.data;
      if (!d) return;

      if (d.type === 'result' && d.requestId === requestId) {
        cleanup();
        hasLiteLoadedOnce = true; // ✅ warmup finished successfully
        resolve(d.decision as ModerationDecision);
      } else if (d.type === 'error' && d.requestId === requestId) {
        cleanup();
        reject(
          new Error(
            d.message || 'Lite worker inference error',
          ),
        );
      }
      // We ignore "status" messages here; they are only for optional UI.
    };

    const handleError = (err: Event | ErrorEvent) => {
      cleanup();
      reject(
        err instanceof ErrorEvent
          ? err.error || new Error(err.message)
          : new Error('Lite worker error'),
      );
    };

    const cleanup = () => {
      w.removeEventListener('message', handleMessage);
      w.removeEventListener('error', handleError);
      if (timeout) clearTimeout(timeout);
    };

    w.addEventListener('message', handleMessage);
    w.addEventListener('error', handleError);

    // ⏱️ Timeout:
    //  - generous for *first* call (warmup: download + init + inference)
    //  - strict for later calls (3s inference SLA)
    const timeoutMs = hasLiteLoadedOnce ? 3_000 : 60_000;
    const timeout = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          hasLiteLoadedOnce
            ? 'Lite inference timeout (3s).'
            : 'Lite warmup timeout (60s).',
        ),
      );
    }, timeoutMs);

    w.postMessage({
      type: 'infer',
      text: trimmed,
      requestId,
    });
  });
}
