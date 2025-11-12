// src/worker/moderationWorker.ts
import * as ort from 'onnxruntime-web'; // use main entry (WASM fallback works)
import {
  MODERATION_LABELS,
  RISKY_CATEGORIES,
  MODERATION_THRESHOLDS,
  type ModerationDecision,
  type ModerationLabel,
} from '../config/moderationconfig';

let session: ort.InferenceSession | null = null;
let tokenizer: { encode: (text: string) => Int32Array } | null = null;
let inited = false;

type FileEntry = { file: string; url: string };

const CACHE_DB = 'moderation-lite-v3';
const CACHE_STORE = 'artifacts';

async function getCached(file: string): Promise<ArrayBuffer | null> {
  return new Promise((resolve) => {
    const open = indexedDB.open(CACHE_DB, 1);
    open.onupgradeneeded = (e) => {
      const db = (e.target as any).result;
      db.createObjectStore(CACHE_STORE);
    };
    open.onsuccess = (e) => {
      const db = (e.target as any).result;
      const tx = db.transaction(CACHE_STORE);
      const get = tx.objectStore(CACHE_STORE).get(file);
      get.onsuccess = () => resolve(get.result ?? null);
    };
    open.onerror = () => resolve(null);
  });
}

async function setCached(file: string, buffer: ArrayBuffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(CACHE_DB, 1);
    open.onsuccess = (e) => {
      const db = (e.target as any).result;
      const tx = db.transaction(CACHE_STORE, 'readwrite');
      tx.objectStore(CACHE_STORE).put(buffer, file);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject();
    };
  });
}

function sigmoid(x: number) {
  return 1 / (1 + Math.exp(-x));
}
function makeAttentionMask(length: number): BigInt64Array {
  return BigInt64Array.from({ length }, () => 1n);
}
function post(type: string, payload: any = {}) {
  (self as any).postMessage({ type, ...payload });
}
function postError(message: string, requestId?: number) {
  post('error', { message, requestId });
}

globalThis.onmessage = async (e) => {
  const { type, payload, requestId } = e.data;

  if (type === 'init') {
    try {
      const { wasmBaseUrl, files } = payload as { wasmBaseUrl: string; files: FileEntry[] };

      // ORT WASM config (single-thread to avoid COOP/COEP)
      const base = wasmBaseUrl.endsWith('/') ? wasmBaseUrl : wasmBaseUrl + '/';
      ort.env.wasm.simd = true;
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.proxy = false;
      ort.env.wasm.wasmPaths = base;

      const ortAny = ort as any;
      if (typeof ortAny.init === 'function') {
        await ortAny.init();
      } else if (typeof ortAny.setWasmPaths === 'function') {
        ortAny.setWasmPaths(base);
      }

      // Fetch artifacts (with caching)
      const map = new Map<string, ArrayBuffer>();
      await Promise.all(
        (files as FileEntry[]).map(async ({ file, url }) => {
          const cached = await getCached(file);
          if (cached) {
            map.set(file, cached);
            return;
          }
          const r = await fetch(url);
          if (!r.ok) throw new Error(`Failed to download ${file} (${r.status})`);
          const buf = await r.arrayBuffer();
          await setCached(file, buf);
          map.set(file, buf);
        })
      );

      // Minimal tokenizer (vocab.txt + special_tokens_map.json)
      const vocabTxt = new TextDecoder().decode(map.get('vocab.txt')!);
      const specialTokens = JSON.parse(new TextDecoder().decode(map.get('special_tokens_map.json')!));

      const vocab = new Map<string, number>();
      vocabTxt.split('\n').forEach((line, i) => {
        const token = line.trim();
        if (token) vocab.set(token, i);
      });

      const cls = typeof specialTokens.cls_token_id === 'number' ? specialTokens.cls_token_id : 101;
      const sep = typeof specialTokens.sep_token_id === 'number' ? specialTokens.sep_token_id : 102;
      const unk = typeof specialTokens.unk_token_id === 'number' ? specialTokens.unk_token_id : 100;

      tokenizer = {
        encode: (text: string): Int32Array => {
          const lower = text.toLowerCase();
          const tokens = lower.split(/\s+/).slice(0, 126);
          const ids = tokens.map(t => vocab.get(t) ?? unk);
          return new Int32Array([cls, ...ids, sep]);
        },
      };

      // Create ORT session (WebGPU if available, otherwise WASM)
      const modelBuf = map.get('model_quantized.onnx')!;
      const providers: ort.InferenceSession.ExecutionProviderName[] = ['webgpu', 'wasm'];
      session = await ort.InferenceSession.create(new Uint8Array(modelBuf), {
        executionProviders: providers,
        graphOptimizationLevel: 'all',
      });

      inited = true;
      post('ready');
    } catch (err: any) {
      postError(`Init failed: ${err?.message || String(err)}`);
    }
  }

  if (type === 'infer') {
    if (!inited || !session || !tokenizer) {
      return postError('Infer called before init', requestId);
    }

    try {
      const { text } = payload as { text: string };
      const inputIds = tokenizer.encode(text);

      const inputTensor = new ort.Tensor(
        'int64',
        BigInt64Array.from(inputIds, v => BigInt(v)),
        [1, inputIds.length]
      );

      const feeds: Record<string, ort.Tensor> = {};
      const inputs = session.inputNames;
      if (inputs.includes('input_ids')) feeds['input_ids'] = inputTensor;
      if (inputs.includes('attention_mask')) {
        feeds['attention_mask'] = new ort.Tensor('int64', makeAttentionMask(inputIds.length), [1, inputIds.length]);
      }

      const result = await session.run(feeds);
      const outName = session.outputNames[0] ?? 'logits';
      const logits = (result as any)[outName].data as Float32Array;
      const probs = Array.from(logits, sigmoid);

      const scores = Object.fromEntries(
        MODERATION_LABELS.map((l, i) => [l, probs[i] ?? 0])
      ) as Record<ModerationLabel, number>;

      let maxRisk = 0;
      let topRisk: ModerationLabel = 'safe';
      RISKY_CATEGORIES.forEach(l => {
        if (scores[l] > maxRisk) {
          maxRisk = scores[l];
          topRisk = l;
        }
      });

      const action =
        maxRisk >= MODERATION_THRESHOLDS.blockCritical ? 'block' :
        maxRisk >= MODERATION_THRESHOLDS.warnAny ? 'warn' : 'allow';

      const decision: ModerationDecision = {
        label: topRisk,
        scores,
        action,
        blocked: action === 'block',
        shouldRequestReview: action === 'warn',
        reason: `Lite: ${action} (${(maxRisk * 100).toFixed(1)}% ${topRisk})`,
        source: 'lite',
      };

      post('result', { decision, requestId });
    } catch (err: any) {
      postError(`Infer failed: ${err?.message || String(err)}`, requestId);
    }
  }
};
