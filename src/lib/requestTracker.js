// lib/requestTracker.js
// Tracks concurrent Supabase/HTTP requests so we can see what's in-flight when OOM hits.
// Usage:
//   const done = trackRequest('Screen.fetchSomething');
//   try { await myFetch(); } finally { done(); }

let _active = 0;
let _peak = 0;

export function trackRequest(label) {
  _active++;
  if (_active > _peak) {
    _peak = _active;
  }
  const t0 = Date.now();

  return function done() {
    _active = Math.max(0, _active - 1);
  };
}

export function activeRequests() {
  return _active;
}
