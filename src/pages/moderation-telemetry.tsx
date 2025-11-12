// src/pages/moderation-telemetry.tsx
'use client';
import { useEffect, useState } from 'react';

type Totals = {
  checks: number; warnings: number; blocks: number;
  overrides_requested: number; overrides_approved: number; overrides_denied: number; overrides_error: number;
};

export default function ModerationTelemetryPage() {
  const [totals, setTotals] = useState<Totals | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const r = await fetch('/api/telemetry/moderation', { cache: 'no-store' });
    const j = await r.json();
    setTotals(j?.totals ?? null);
    setLoading(false);
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 2000); // live-ish
    return () => clearInterval(id);
  }, []);

  return (
    <main className="min-h-screen bg-slate-50 py-12 px-6">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-2xl font-semibold text-slate-900">Moderation Telemetry</h1>
        <p className="text-slate-500 mt-1">Counts since server start (resets on restart).</p>

        <div className="mt-8 grid grid-cols-2 md:grid-cols-3 gap-4">
          {loading && <p className="col-span-full text-slate-500">Loading…</p>}
          {totals && Object.entries(totals).map(([k, v]) => (
            <div key={k} className="rounded-xl border bg-white p-4 shadow-sm">
              <div className="text-xs uppercase tracking-wide text-slate-500">{k.replace(/_/g, ' ')}</div>
              <div className="mt-1 text-3xl font-bold text-slate-900">{v}</div>
            </div>
          ))}
        </div>

        <button
          onClick={load}
          className="mt-8 inline-flex items-center rounded-lg bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700 active:scale-95"
        >
          Refresh
        </button>
      </div>
    </main>
  );
}
