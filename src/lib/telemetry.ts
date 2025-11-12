// Simple in-memory counters (reset on server restart)
export type TelemetryCounters = {
  checks: number;
  warns: number;
  blocks: number;
  overrides_requested: number;
  overrides_approved: number;
  overrides_rejected: number;
  source_lite: number;
  source_backend: number;
};

const counters: TelemetryCounters = {
  checks: 0,
  warns: 0,
  blocks: 0,
  overrides_requested: 0,
  overrides_approved: 0,
  overrides_rejected: 0,
  source_lite: 0,
  source_backend: 0,
};

export function recordEvents(events: any[]) {
  for (const e of events) {
    if (e.type === 'check_performed') {
      counters.checks += 1;
      if (e.action === 'warn') counters.warns += 1;
      if (e.action === 'block') counters.blocks += 1;
      if (e.source === 'lite') counters.source_lite += 1;
      if (e.source === 'backend') counters.source_backend += 1;
    }
    if (e.type === 'override_requested') counters.overrides_requested += 1;
    if (e.type === 'override_result') {
      if (e.outcome === 'approved') counters.overrides_approved += 1;
      if (e.outcome === 'rejected') counters.overrides_rejected += 1;
    }
  }
}

export function snapshotCounters(): TelemetryCounters {
  return { ...counters };
}
