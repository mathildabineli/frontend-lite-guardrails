// src/pages/api/moderation/check.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import {
  BACKEND_MULTILABEL_CONFIG,
  type ModerationLabel,
  type ModerationDecision,
} from '@/config/moderationconfig';

const INTERNAL_MODERATION_INFERENCE_URL =
  process.env.INTERNAL_MODERATION_INFERENCE_URL;

const MODERATION_ENABLED =
  process.env.MODERATION_ENABLED === 'true' || false; // Non-public env

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ModerationDecision | { error: string }>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { text, clientDecision } = req.body as {
    text?: string;
    clientDecision?: Partial<ModerationDecision>;
  };

  if (!text?.trim()) {
    return res.status(400).json({ error: 'Missing text' });
  }

  const cfg = BACKEND_MULTILABEL_CONFIG;
  const safeLabel: ModerationLabel = (cfg.safeLabels[0] ??
    'safe') as ModerationLabel;

  // Helper to build a “safe / allow” decision (used when disabled or errors)
  const makeSafeDecision = (reason: string): ModerationDecision => {
    const scores: Record<ModerationLabel, number> = {} as any;
    for (const label of cfg.labels) {
      scores[label as ModerationLabel] =
        (label as ModerationLabel) === safeLabel ? 1 : 0;
    }
    return {
      label: safeLabel,
      scores,
      action: 'allow',
      blocked: false,
      shouldRequestReview: false,
      reason,
      source: 'backend',
    };
  };

  if (!MODERATION_ENABLED || !INTERNAL_MODERATION_INFERENCE_URL) {
    return res.status(200).json(makeSafeDecision('moderation disabled'));
  }

  const inputText = text.trim();
  let backendError = false;

  // Initialise scores with 0 for all known labels
  const scores: Record<ModerationLabel, number> = {} as any;
  for (const label of cfg.labels) {
    scores[label as ModerationLabel] = 0;
  }

  let maxRisk = 0;
  let topRisk: ModerationLabel = safeLabel;

  try {
    const response = await fetch(INTERNAL_MODERATION_INFERENCE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inputs: { inputs: [inputText] }, // backend expects array
      }),
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();

    // Expected shapes: [[{label, score}]] OR [{label, score}] OR {label, score}
    const level1 = Array.isArray(data) ? data : [data];
    const flat = Array.isArray(level1[0]) ? level1[0] : level1;

    (flat as any[]).forEach((item: { label: string; score: number }) => {
      const label = item.label as ModerationLabel;
      if (cfg.labels.includes(label)) {
        const s = typeof item.score === 'number' ? item.score : 0;
        scores[label] = s;

        if (cfg.riskyLabels.includes(label) && s > maxRisk) {
          maxRisk = s;
          topRisk = label;
        }
      }
    });
  } catch (err) {
    console.error('[moderation-check] Backend failed:', err);
    backendError = true;
  }

  // Ensure safe label isn't missing entirely
  if (scores[safeLabel] === 0) {
    const riskyMax = Math.max(
      ...cfg.riskyLabels.map((l) => scores[l as ModerationLabel] ?? 0),
      0
    );
    scores[safeLabel] = Math.max(1 - riskyMax, 0);
  }

  const { block, warn } = cfg.thresholds;
  const action =
    maxRisk >= block ? 'block' : maxRisk >= warn ? 'warn' : 'allow';

  const decision: ModerationDecision = {
    label: action === 'allow' ? safeLabel : topRisk,
    scores,
    action,
    blocked: action === 'block',
    shouldRequestReview: action === 'warn',
    reason: backendError
      ? 'Backend unavailable – partial scores'
      : `Backend: ${action} (${(maxRisk * 100).toFixed(1)}% ${topRisk})`,
    source: 'backend',
  };

  // Optional audit of client vs server decision (still only on submission)
  if (clientDecision) {
    console.log('[moderation-audit]', {
      input: inputText,
      client: clientDecision,
      server: decision,
      backendError,
    });
  }

  return res.status(200).json(decision);
}
