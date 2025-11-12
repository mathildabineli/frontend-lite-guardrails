// src/pages/api/moderation/check.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import {
  MODERATION_LABELS,
  type ModerationLabel,
  type ModerationDecision,
  MODERATION_THRESHOLD_BLOCK,
  MODERATION_THRESHOLD_WARN,
  RISKY_CATEGORIES,
} from '@/config/moderationconfig';

const INTERNAL_MODERATION_INFERENCE_URL = process.env.INTERNAL_MODERATION_INFERENCE_URL;

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

  const inputText = text.trim();
  let backendError = false;
  let scores: Record<ModerationLabel, number> = Object.fromEntries(
    MODERATION_LABELS.map(l => [l, 0])
  ) as any;

  let maxRisk = 0;
  let topRisk: ModerationLabel = 'safe';

  try {
    const response = await fetch(INTERNAL_MODERATION_INFERENCE_URL!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inputs: { inputs: [inputText] }, // your backend expects array
      }),
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();

    // Expected shapes: [[{label, score}]] OR [{label, score}] OR {label, score}
    const level1 = Array.isArray(data) ? data : [data];
    const flat = Array.isArray(level1[0]) ? level1[0] : level1;

    (flat as any[]).forEach((item: { label: string; score: number }) => {
      const label = item.label?.toLowerCase() as ModerationLabel;
      if (MODERATION_LABELS.includes(label)) {
        scores[label] = item.score;
        if (RISKY_CATEGORIES.includes(label) && item.score > maxRisk) {
          maxRisk = item.score;
          topRisk = label;
        }
      }
    });
  } catch (err) {
    console.error('[moderation-check] Backend failed:', err);
    backendError = true;
  }

  // Ensure "safe" isn't missing entirely
  if (scores.safe === 0) {
    const riskyMax = Math.max(...RISKY_CATEGORIES.map(l => scores[l] ?? 0), 0);
    scores.safe = Math.max(1 - riskyMax, 0);
  }

  const action =
    maxRisk >= MODERATION_THRESHOLD_BLOCK ? 'block' :
    maxRisk >= MODERATION_THRESHOLD_WARN ? 'warn' : 'allow';

  const decision: ModerationDecision = {
    label: topRisk,
    scores,
    action,
    blocked: action === 'block',
    shouldRequestReview: action === 'warn',
    reason: backendError
      ? 'Backend unavailable – partial scores'
      : `Backend: ${action} (${(maxRisk * 100).toFixed(1)}% ${topRisk})`,
    source: 'backend',
  };

  // Audit
  if (clientDecision) {
    console.log('[moderation-audit]', {
      input: inputText,
      client: clientDecision,
      server: decision,
      backendError,
    });
  }

  res.status(200).json(decision);
}
