// src/pages/api/telemetry/moderation.ts
import type { NextApiRequest, NextApiResponse } from 'next';

// Optional external forwarder (Grafana, your backend, etc.)
const FORWARD_URL = process.env.TELEMETRY_INGEST_URL || '';
const MODERATION_TELEMETRY_ENABLED = process.env.MODERATION_TELEMETRY_ENABLED === 'true' || false;

type Event =
  | { type: 'check_performed'; label: string; action: 'allow' | 'warn' | 'block'; source?: 'lite' | 'backend'; latency_ms?: number; text_len?: number }
  | { type: 'override_requested'; label: string }
  | { type: 'override_result'; outcome: 'approved' | 'rejected' | 'denied' | 'error'; label: string };

export type TelemetryTotals = {
  checks: number;
  warnings: number;
  blocks: number;
  overrides_requested: number;
  overrides_approved: number;
  overrides_denied: number;
  overrides_error: number;
};

// In-memory counters (reset on server restart)
const totals: TelemetryTotals = {
  checks: 0,
  warnings: 0,
  blocks: 0,
  overrides_requested: 0,
  overrides_approved: 0,
  overrides_denied: 0,
  overrides_error: 0,
};

export const config = {
  api: { bodyParser: { sizeLimit: '1mb' } },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!MODERATION_TELEMETRY_ENABLED) {
    if (req.method === 'GET') {
      return res.status(200).json({ ok: true, totals: { checks: 0, warnings: 0, blocks: 0, overrides_requested: 0, overrides_approved: 0, overrides_denied: 0, overrides_error: 0 } });
    }
    return res.status(200).json({ ok: true, forwarded: 0, stored: 0, totals: { checks: 0, warnings: 0, blocks: 0, overrides_requested: 0, overrides_approved: 0, overrides_denied: 0, overrides_error: 0 } });
  }

  // Quick way to SEE totals from your browser or curl
  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, totals });
  }
  if (req.method !== 'POST') return res.status(405).end();

  const body = req.body as { events?: Event[] } | null;
  if (!body?.events || !Array.isArray(body.events)) {
    return res.status(400).json({ ok: false, error: 'invalid payload' });
  }

  // light sanitation
  const events = body.events.slice(0, 100).map((e: any) => {
    delete e.text;
    delete e.payload;
    return e as Event;
  });

  // Update counters
  for (const e of events) {
    if (e.type === 'check_performed') {
      totals.checks += 1;
      if (e.action === 'warn') totals.warnings += 1;
      if (e.action === 'block') totals.blocks += 1;
    } else if (e.type === 'override_requested') {
      totals.overrides_requested += 1;
    } else if (e.type === 'override_result') {
      if (e.outcome === 'approved') totals.overrides_approved += 1;
      else if (e.outcome === 'rejected' || e.outcome === 'denied') totals.overrides_denied += 1;
      else if (e.outcome === 'error') totals.overrides_error += 1;
    }
  }

  // Local dev: log what came in
  if (!FORWARD_URL) {
    // eslint-disable-next-line no-console
    console.log('[telemetry/moderation]', JSON.stringify({ count: events.length, events }));
    return res.status(200).json({ ok: true, stored: events.length, totals });
  }

  // Optional: forward upstream
  try {
    const r = await fetch(FORWARD_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stream: 'moderation', events }),
    });
    if (!r.ok) throw new Error(`upstream ${r.status}`);
    return res.status(200).json({ ok: true, forwarded: events.length, totals });
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error('[telemetry/moderation] forward failed:', err?.message || err);
    return res.status(200).json({ ok: true, forwarded: 0, stored: 0, totals });
  }
}