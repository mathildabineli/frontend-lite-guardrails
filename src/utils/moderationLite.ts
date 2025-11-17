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
    scores[label as ModerationLabel] = label === safeLabel ? 1 : 0;
  }
  return scores;
}

let nextRequestId = 1;
let hasLiteLoadedOnce = false;   // ✅ true once warmup+first inference succeeded
let warmupStarted = false;       // to avoid starting multiple warmups

/**
 * Fire-and-forget warmup.
 * Downloads tokenizer + model and runs one dummy inference.
 * Never blocks the caller; only flips hasLiteLoadedOnce when done.
 */
function startWarmupIfNeeded() {
  if (hasLiteLoadedOnce || warmupStarted || !activeLiteConfig) return;

  warmupStarted = true;
  const w = getWorker();
  const requestId = nextRequestId++;
  const WARMUP_TEXT = 'warmup';

  const handleMessage = (e: MessageEvent) => {
    const d = e.data;
    if (!d || d.requestId !== requestId) return;

    if (d.type === 'result') {
      cleanup();
      hasLiteLoadedOnce = true;
      // optional: console.log('[moderationLite] warmup succeeded');
    } else if (d.type === 'error') {
      cleanup();
      warmupStarted = false; // allow retry on a later call
      console.error('[moderationLite] warmup worker error:', d.message);
    }
  };

  const handleError = (err: Event | ErrorEvent) => {
    cleanup();
    warmupStarted = false;
    console.error('[moderationLite] warmup failed:', err);
  };

  const cleanup = () => {
    w.removeEventListener('message', handleMessage);
    w.removeEventListener('error', handleError);
    if (timeout) clearTimeout(timeout);
  };

  // generous timeout for background warmup
  const timeout = setTimeout(() => {
    cleanup();
    warmupStarted = false;
    console.warn('[moderationLite] warmup timeout (30s), will retry later');
  }, 30_000);

  w.addEventListener('message', handleMessage);
  w.addEventListener('error', handleError);

  w.postMessage({
    type: 'infer',
    text: WARMUP_TEXT,
    requestId,
  });
}

/**
 * Main lite moderation entrypoint.
 *
 * ❗ New behavior:
 *  - If the lite model has NOT finished warmup yet, we:
 *    - start warmup in the background (if not already running)
 *    - immediately reject with an Error("Lite model warming up")
 *  - Caller (useModerationGuard) should catch that and fallback to backend.
 */
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
      label: (activeLiteConfig.safeLabels[0] ?? 'safe') as ModerationLabel,
      scores: makeSafeScores(),
      action: 'allow',
      blocked: false,
      shouldRequestReview: false,
      reason: 'empty input',
      source: 'lite',
    };
  }

  // 👇 NEW: non-blocking warmup + fast fallback
  if (!hasLiteLoadedOnce) {
    startWarmupIfNeeded();
    // fail fast so the caller can immediately fallback to backend
    return Promise.reject(
      new Error('Lite model warming up – use backend fallback'),
    );
  }

  // From here, lite model is known to be warm.
  const w = getWorker();
  const requestId = nextRequestId++;

  return new Promise<ModerationDecision>((resolve, reject) => {
    const handleMessage = (e: MessageEvent) => {
      const d = e.data;
      if (!d || d.requestId !== requestId) return;

      if (d.type === 'result') {
        cleanup();
        hasLiteLoadedOnce = true; // just in case
        resolve(d.decision as ModerationDecision);
      } else if (d.type === 'error') {
        cleanup();
        reject(
          new Error(d.message || 'Lite worker inference error'),
        );
      }
      // ignore 'status' messages
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

    // strict SLA for real requests once warm
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Lite inference timeout (3s).'));
    }, 3_000);

    w.addEventListener('message', handleMessage);
    w.addEventListener('error', handleError);

    w.postMessage({
      type: 'infer',
      text: trimmed,
      requestId,
    });
  });
}
