// src/config/moderationConfig.ts

// Labels are now generic strings so we can plug different models.
export type ModerationLabel = string;

export type ModerationAction = 'allow' | 'warn' | 'block' | 'fallback';

export interface ModerationDecision {
  label: ModerationLabel;                  // winning label (e.g. "toxic", "harassment", "safe")
  scores: Record<ModerationLabel, number>; // per-label probabilities
  action: ModerationAction;
  blocked: boolean;
  shouldRequestReview: boolean;
  reason: string;
  source: 'lite' | 'backend';
}

/**
 * Generic config describing any moderation model (lite or backend).
 * This is what makes the system pluggable.
 */
export interface ModerationModelConfig {
  /** Internal id for the model (used in envs / selection) */
  id: string;

  /** "binary" (safe/unsafe) or "multilabel" (many categories) */
  kind: 'binary' | 'multilabel';

  /** Exact label list in the model's id2label order */
  labels: ModerationLabel[];

  /** Which labels are considered "risky" vs "safe" */
  riskyLabels: ModerationLabel[];
  safeLabels: ModerationLabel[];

  /** Thresholds for the frontend decision logic */
  thresholds: {
    block: number;   // ≥ block => block
    warn: number;    // ≥ warn  => warn  (if < block)
  };
}

/* ------------------------------------------------------------------ */
/*  Lite model: gravitee-io/bert-tiny-toxicity (binary)               */
/* ------------------------------------------------------------------ */

export const BERT_TINY_TOXICITY_CONFIG: ModerationModelConfig = {
  id: 'bert-tiny-toxicity',
  kind: 'binary',
  // Must match the ONNX / HF model labels:
  // usually id2label: {0: "not-toxic", 1: "toxic"}
  labels: ['not-toxic', 'toxic'],
  riskyLabels: ['toxic'],
  safeLabels: ['not-toxic'],

  // Start conservative; you can tune later from telemetry:
  thresholds: {
    warn: 0.43,   // >= 0.25 toxic -> warn
    block: 0.5,  // >= 0.45 toxic -> block
  },
};

/* ------------------------------------------------------------------ */
/*  Backend full model (example: mDeBERTa multi-label)                */
/*  Keep your previous categories here; this is just an example.      */
/* ------------------------------------------------------------------ */

export const BACKEND_MULTILABEL_CONFIG: ModerationModelConfig = {
  id: 'mdeberta-multilabel',
  kind: 'multilabel',
  labels: [
    'harassment',
    'violence',
    'sexual',
    'exploitation',
    'harm',
    'illicit',
    'informational',
    'safe',
  ],
  riskyLabels: [
    'harassment',
    'violence',
    'sexual',
    'exploitation',
    'harm',
    'illicit',
    'informational',
  ],
  safeLabels: ['safe'],
  thresholds: {
    warn: 0.3,
    block: 0.35,
  },
};

/* ------------------------------------------------------------------ */
/*  Active lite model selection                                      */
/* ------------------------------------------------------------------ */

/**
 * Map of known lite models – you can add more later.
 */
const LITE_MODELS: Record<string, ModerationModelConfig> = {
  [BERT_TINY_TOXICITY_CONFIG.id]: BERT_TINY_TOXICITY_CONFIG,
};

export function getActiveLiteModelConfig(): ModerationModelConfig | null {
  const id =
    process.env.NEXT_PUBLIC_LITE_MODEL_ID || 'bert-tiny-toxicity'; // default

  return LITE_MODELS[id] ?? null;
}
