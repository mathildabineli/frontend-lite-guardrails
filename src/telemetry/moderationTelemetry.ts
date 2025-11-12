// Lightweight telemetry client for moderation events.
// Batches events and POSTs to /api/telemetry/moderation.
// Never include raw user text here.

type CheckEvent = {
  v: 1;
  ts: number;
  sid: string;
  route: string;
  type: 'check_performed';
  label: string;
  action: 'allow' | 'warn' | 'block';
  source: 'lite' | 'backend';
  latency_ms?: number;
  text_len?: number;
};

type OverrideReqEvent = {
  v: 1;
  ts: number;
  sid: string;
  route: string;
  type: 'override_requested';
  label: string;
};

type OverrideResEvent = {
  v: 1;
  ts: number;
  sid: string;
  route: string;
  type: 'override_result';
  outcome: 'approved' | 'rejected' | 'error';
  label: string;
};

type Event = CheckEvent | OverrideReqEvent | OverrideResEvent;

const ENDPOINT = '/api/telemetry/moderation';
const MAX_BATCH = 50;
const FLUSH_MS = 1500;

let queue: Event[] = [];
let timer: number | null = null;

function sid(): string {
  try {
    const k = 'ts_sid';
    const existing = sessionStorage.getItem(k);
    if (existing) return existing;
    const s = Math.random().toString(36).slice(2) + Date.now().toString(36);
    sessionStorage.setItem(k, s);
    return s;
  } catch {
    return 'anon';
  }
}

function route(): string {
  try {
    return location.pathname || '/';
  } catch {
    return '/';
  }
}

function push(ev: Event) {
  queue.push(ev);
  if (queue.length >= MAX_BATCH) flush();
  if (timer == null) {
    timer = window.setTimeout(() => {
      timer = null;
      flush();
    }, FLUSH_MS);
  }
}

export function flush() {
  if (queue.length === 0) return;
  const payload = { events: queue.slice() };
  queue = [];
  // Prefer sendBeacon (non-blocking on unload), fallback to fetch
  try {
    const ok = navigator.sendBeacon?.(ENDPOINT, new Blob([JSON.stringify(payload)], { type: 'application/json' }));
    if (ok) return;
  } catch {/* ignore */}
  fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => {});
}

function base() {
  return { v: 1 as const, ts: Date.now(), sid: sid(), route: route() };
}

// ---- Public API ----
export function trackCheck(args: {
  label: string;
  action: 'allow' | 'warn' | 'block';
  source: 'lite' | 'backend';
  latency_ms?: number;
  text_len?: number;
}) {
  push({ ...base(), type: 'check_performed', ...args });
}

export function trackOverrideRequested(label: string) {
  push({ ...base(), type: 'override_requested', label });
}

export function trackOverrideResult(outcome: 'approved' | 'rejected' | 'error', label: string) {
  push({ ...base(), type: 'override_result', outcome, label });
}

// Flush on page hide/unload
if (typeof window !== 'undefined') {
  addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
  addEventListener('pagehide', flush);
}
