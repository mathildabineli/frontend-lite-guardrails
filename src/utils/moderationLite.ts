// src/utils/moderationLite.ts
import { MODERATION_LABELS, type ModerationDecision } from '@/config/moderationconfig';

let worker: Worker | null = null;
let readyPromise: Promise<void> | null = null;

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('../worker/moderationWorker.ts', import.meta.url), { type: 'module' });
  }
  return worker;
}

function withTrailingSlash(s: string) {
  return s.endsWith('/') ? s : s + '/';
}

const USE_PROXY = (process.env.NEXT_PUBLIC_MODEL_PROXY || '') === '1';

type FileEntry = { file: string; url: string };

async function getFilesForInit(): Promise<FileEntry[]> {
  if (USE_PROXY) {
    // Same-origin streaming: no CORS needed
    const names = [
      'model_quantized.onnx',
      'tokenizer.json',
      'config.json',
      'vocab.txt',
      'special_tokens_map.json',
      'tokenizer_config.json',
    ];
    return names.map((n) => ({
      file: n,
      url: `${location.origin}/api/moderation/model?file=${encodeURIComponent(n)}`
    }));
  }

  // Presigned URL mode (CORS required on MinIO bucket)
  const res = await fetch('/api/moderation/model');
  if (!res.ok) throw new Error(`model manifest HTTP ${res.status}`);
  const data = await res.json();
  const files = (Array.isArray(data?.files) ? data.files : []) as FileEntry[];
  if (!files.length) throw new Error('model manifest empty');
  return files;
}

async function ensureReady() {
  if (!readyPromise) {
    readyPromise = new Promise((resolve, reject) => {
      const w = getWorker();

      const onMessage = (e: MessageEvent) => {
        if (e.data?.type === 'ready') {
          cleanup();
          resolve();
        } else if (e.data?.type === 'error') {
          console.error('[moderation worker error]', e.data?.message);
          cleanup();
          reject(new Error(e.data?.message || 'Worker init error'));
        }
      };

      const onError = (err: ErrorEvent) => {
        cleanup();
        reject(err.error || new Error(err.message));
      };

      const cleanup = () => {
        w.removeEventListener('message', onMessage);
        w.removeEventListener('error', onError);
        clearTimeout(timeout);
      };

      w.addEventListener('message', onMessage);
      w.addEventListener('error', onError);

      (async () => {
        try {
          const wasmBaseUrl = withTrailingSlash(`${location.origin}/ort`);
          const files = await getFilesForInit();
          w.postMessage({ type: 'init', payload: { wasmBaseUrl, files } });
        } catch (e: any) {
          cleanup();
          reject(e instanceof Error ? e : new Error(String(e)));
        }
      })();

      // Big model (~136 MB) → give time to download + init
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Worker init timed out (45s).'));
      }, 45_000);
    });
  }
  await readyPromise;
}

let nextRequestId = 1;

export async function runModerationLite(text: string): Promise<ModerationDecision> {
  if (!text.trim()) {
    return {
      label: 'safe',
      scores: Object.fromEntries(MODERATION_LABELS.map(l => [l, l === 'safe' ? 1 : 0])) as any,
      action: 'allow',
      blocked: false,
      shouldRequestReview: false,
      reason: 'empty input',
      source: 'lite',
    } as ModerationDecision;
  }

  await ensureReady();
  const w = getWorker();
  const requestId = nextRequestId++;

  return new Promise((resolve, reject) => {
    const handler = (e: MessageEvent) => {
      const d = e.data;
      if (d?.type === 'result' && d?.requestId === requestId) {
        cleanup();
        resolve(d.decision as ModerationDecision);
      } else if (d?.type === 'error' && d?.requestId === requestId) {
        cleanup();
        reject(new Error(d?.message || 'Worker inference error'));
      }
    };

    const onErr = (err: Event | ErrorEvent) => {
      cleanup();
      reject(err instanceof ErrorEvent ? err.error : new Error('Worker error'));
    };

    const cleanup = () => {
      w.removeEventListener('message', handler);
      w.removeEventListener('error', onErr);
      clearTimeout(timeout);
    };

    w.addEventListener('message', handler);
    w.addEventListener('error', onErr);

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Lite inference timeout (3s).'));
    }, 3_000);

    w.postMessage({ type: 'infer', payload: { text }, requestId });
  });
}
