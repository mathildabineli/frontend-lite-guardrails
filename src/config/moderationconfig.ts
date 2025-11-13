// src/config/moderationconfig.ts

/**
 * Labels must match the model's id2label mapping exactly.
 *
 *  "id2label": {
 *    "0": "harassment",
 *    "1": "violence",
 *    "2": "sexual",
 *    "3": "exploitation",
 *    "4": "harm",
 *    "5": "illicit",
 *    "6": "informational",
 *    "7": "safe"
 *  }
 */
export const MODERATION_LABELS = [
  'harassment',
  'violence',
  'sexual',
  'exploitation',
  'harm',
  'illicit',
  'informational',
  'safe',
] as const;

export type ModerationLabel = (typeof MODERATION_LABELS)[number];

export type ModerationAction = 'allow' | 'warn' | 'block' | 'fallback';

export interface ModerationDecision {
  label: ModerationLabel;
  scores: Record<ModerationLabel, number>;
  action: ModerationAction;
  blocked: boolean;
  shouldRequestReview: boolean;
  reason: string;
  /** Where the decision came from – lite (WebWorker) or backend */
  source: 'lite' | 'backend';
}

/**
 * Thresholds for the **lite client-side check**.
 * Tune empirically; these are sane starting values.
 */
export const MODERATION_THRESHOLDS = {
  blockCritical: 0.35, // Any risky label ≥ 0.50 → block
  warnAny: 0.3,       // Any risky label ≥ 0.40 → warn + review
};

/**
 * Thresholds for **backend full model** (often stricter/more calibrated).
 * Adjust to your real backend calibration. Comments match values.
 */
export const MODERATION_THRESHOLD_BLOCK = 0.35 // ≥70% → block
export const MODERATION_THRESHOLD_WARN  = 0.3; // ≥50% → warn

/** Categories considered risky. */
export const RISKY_CATEGORIES: ModerationLabel[] = [
  'harassment',
  'violence',
  'sexual',
  'exploitation',
  'harm',
  'illicit',
  'informational',
];

/** Non-risky labels. */
export const NON_RISKY_CATEGORIES: ModerationLabel[] = ['safe'];

// Feature flags / endpoints
export const MODERATION_FF_LITE_ENABLED = true;
export const MODERATION_FALLBACK_ENDPOINT = '/api/moderation/check';
