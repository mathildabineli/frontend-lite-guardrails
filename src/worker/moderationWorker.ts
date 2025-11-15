// src/worker/moderationWorker.ts
/* eslint-disable no-restricted-globals */
/* eslint-disable @typescript-eslint/no-explicit-any */

import * as ort from 'onnxruntime-web';
import {
  BERT_TINY_TOXICITY_CONFIG as cfg,
  type ModerationDecision,
  type ModerationLabel,
} from '../config/moderationconfig';

// -----------------------------------------------------------------------------
// 0. ONNX Runtime CONFIG – WASM only (simple & stable)
// -----------------------------------------------------------------------------

// OPTIONAL: lower noise while debugging
// ort.env.debug = true;
// ort.env.logLevel = 'info';

// single-threaded → no crossOriginIsolated / COOP+COEP needed
ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;
ort.env.wasm.simd = true;

// All .wasm files live in /public/ort → served under /ort/...
// prefix form is enough for most cases
(ort.env.wasm as any).wasmPaths = {
  'ort-wasm.wasm': '/ort/ort-wasm.wasm',
  'ort-wasm-simd.wasm': '/ort/ort-wasm-simd.wasm',
  'ort-wasm-threaded.wasm': '/ort/ort-wasm-threaded.wasm',
  'ort-wasm-simd-threaded.wasm': '/ort/ort-wasm-simd-threaded.wasm',
  // ORT sometimes asks for this jsep variant; alias to simd:
  'ort-wasm-simd.jsep.wasm': '/ort/ort-wasm-simd.wasm',
} as any;

// -----------------------------------------------------------------------------
// 1. CONFIG
// -----------------------------------------------------------------------------
const MODEL_FOLDER = 'toxicity-binary-text-cls';
const PRESIGNED_API = '/api/moderation/presign';
const CACHE_NAME = 'lite-model-v1';

// -----------------------------------------------------------------------------
// 2. Cache Helper (IndexedDB via Cache API)
// -----------------------------------------------------------------------------
async function getCachedOrFetch(url: string, file: string): Promise<ArrayBuffer> {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(url);
  if (cached) {
    console.log(`[worker] Using cached ${file}`);
    return cached.arrayBuffer();
  }

  console.log(`[worker] Downloading ${file}...`);
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`${file} fetch failed: ${resp.status} ${resp.statusText}`);
  const buffer = await resp.arrayBuffer();
  await cache.put(url, new Response(buffer));
  return buffer;
}

// -----------------------------------------------------------------------------
// 3. Presigned URL
// -----------------------------------------------------------------------------
async function getPresignedUrl(file: string): Promise<string> {
  const url = `${PRESIGNED_API}?file=${MODEL_FOLDER}/${file}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Presign failed for ${file}: ${resp.status}`);
  const data = await resp.json();
  if (!data.url) throw new Error(`Invalid presign response: ${JSON.stringify(data)}`);
  return data.url;
}

// -----------------------------------------------------------------------------
// 4. Singleton Model Loader
// -----------------------------------------------------------------------------
class ModerationLite {
  static instance: Promise<ModerationLite> | null = null;

  private session!: ort.InferenceSession;
  private vocab!: Map<string, number>;
  private specialTokens = { '[CLS]': 101, '[SEP]': 102, '[UNK]': 100 };

  private constructor() {}

  static async getInstance(
    onProgress?: (progress: { status: string; file?: string; percent?: number }) => void,
  ): Promise<ModerationLite> {
    if (!this.instance) {
      this.instance = (async () => {
        const lite = new ModerationLite();
        await lite.load(onProgress);
        return lite;
      })();
    }
    return this.instance;
  }

  private async load(
    onProgress?: (progress: { status: string; file?: string; percent?: number }) => void,
  ) {
    onProgress?.({ status: 'initiate' });

    // 1) Tokenizer
    onProgress?.({ status: 'downloading', file: 'tokenizer.json', percent: 0 });
    const tokenizerUrl = await getPresignedUrl('tokenizer.json');
    console.log('[worker] Tokenizer URL:', tokenizerUrl);

    const tokenizerResp = await fetch(tokenizerUrl);
    if (!tokenizerResp.ok) {
      throw new Error(
        `Tokenizer fetch failed: ${tokenizerResp.status} ${tokenizerResp.statusText}`,
      );
    }
    const tokenizerData = await tokenizerResp.json();
    this.vocab = new Map(
      Object.entries(tokenizerData.model.vocab).map(([k, v]) => [k, Number(v)]),
    );
    onProgress?.({ status: 'downloading', file: 'tokenizer.json', percent: 100 });

    // 2) ONNX model (cached)
    onProgress?.({ status: 'downloading', file: 'model.onnx', percent: 0 });
    const onnxUrl = await getPresignedUrl('model.onnx');
    console.log('[worker] Model URL:', onnxUrl);

    const arrayBuffer = await getCachedOrFetch(onnxUrl, 'model.onnx');
    onProgress?.({ status: 'downloading', file: 'model.onnx', percent: 50 });

    // WASM session
    this.session = await ort.InferenceSession.create(arrayBuffer, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });

    onProgress?.({ status: 'downloading', file: 'model.onnx', percent: 100 });
    console.log('[worker] Lite model ready (cached for next load)');
    onProgress?.({ status: 'ready' });
  }

  private tokenize(text: string): { input_ids: BigInt64Array; attention_mask: BigInt64Array } {
    const tokens: number[] = [this.specialTokens['[CLS]']];
    const words = text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(Boolean);

    for (const word of words) {
      tokens.push(this.vocab.get(word) ?? this.specialTokens['[UNK]']);
    }
    tokens.push(this.specialTokens['[SEP]']);

    const input_ids = new BigInt64Array(tokens.map(BigInt));
    const attention_mask = new BigInt64Array(tokens.length).fill(BigInt(1));

    return { input_ids, attention_mask };
  }

  async classify(text: string): Promise<Array<{ label: string; score: number }>> {
    const { input_ids, attention_mask } = this.tokenize(text);

    const feeds: Record<string, ort.Tensor> = {
      input_ids: new ort.Tensor('int64', input_ids, [1, input_ids.length]),
      attention_mask: new ort.Tensor('int64', attention_mask, [1, attention_mask.length]),
    };

    const results = await this.session.run(feeds);
    const logits = results.logits.data as Float32Array;

    const max = Math.max(...logits);
    const exps = Array.from(logits).map((x) => Math.exp(x - max));
    const sum = exps.reduce((a, b) => a + b, 0);
    const probs = exps.map((x) => x / sum);

    return [
      { label: 'not-toxic', score: probs[0] },
      { label: 'toxic', score: probs[1] },
    ];
  }
}

// -----------------------------------------------------------------------------
// 5. Worker Messaging
// -----------------------------------------------------------------------------
type WorkerMessage =
  | { type: 'infer'; text: string; requestId: number }
  | { type: string; [key: string]: any };

function post(type: string, payload: any = {}) {
  (self as any).postMessage({ type, ...payload });
}

function safeDecision(reason: string): ModerationDecision {
  const safeLabel = (cfg.safeLabels[0] ?? 'not-toxic') as ModerationLabel;
  const scores: Record<ModerationLabel, number> = {} as any;
  for (const label of cfg.labels) {
    scores[label as ModerationLabel] = label === safeLabel ? 1 : 0;
  }
  return {
    label: safeLabel,
    scores,
    action: 'allow',
    blocked: false,
    shouldRequestReview: false,
    reason,
    source: 'lite',
  };
}

// -----------------------------------------------------------------------------
// 6. Main Loop
// -----------------------------------------------------------------------------
self.addEventListener('message', async (event: MessageEvent<WorkerMessage>) => {
  const { type, text, requestId } = event.data;
  if (type !== 'infer') return;

  try {
    const trimmed = (text || '').trim();
    if (!trimmed) {
      post('result', { decision: safeDecision('empty input'), requestId });
      return;
    }

    const lite = await ModerationLite.getInstance((progress) => {
      post('status', { ...progress, requestId });
    });

    const outputs = await lite.classify(trimmed);

    const scores: Record<ModerationLabel, number> = {} as any;
    for (const label of cfg.labels) scores[label as ModerationLabel] = 0;
    for (const { label, score } of outputs) {
      const lbl = label.toLowerCase();
      if (cfg.labels.includes(lbl as any)) {
        scores[lbl as ModerationLabel] = score;
      }
    }

    let maxRisk = 0;
    let topRisk: ModerationLabel = (cfg.safeLabels[0] as ModerationLabel) ?? 'not-toxic';
    for (const label of cfg.riskyLabels) {
      const s = scores[label as ModerationLabel] ?? 0;
      if (s > maxRisk) {
        maxRisk = s;
        topRisk = label as ModerationLabel;
      }
    }

    const { block, warn } = cfg.thresholds;
    const action = maxRisk >= block ? 'block' : maxRisk >= warn ? 'warn' : 'allow';
    const safeLabel = (cfg.safeLabels[0] ?? 'not-toxic') as ModerationLabel;

    const decision: ModerationDecision = {
      label: action === 'allow' ? safeLabel : topRisk,
      scores,
      action,
      blocked: action === 'block',
      shouldRequestReview: action === 'warn',
      reason: `Lite (${cfg.id}): ${action} (${(maxRisk * 100).toFixed(1)}% ${topRisk})`,
      source: 'lite',
    };

    post('result', { decision, requestId });
  } catch (err: any) {
    const message = err?.message || String(err);
    console.error('[worker] error:', err);
    post('error', { requestId, message });
  }
});
