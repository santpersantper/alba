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
  const warn = _active >= 5;
  console.log(
    `[REQ${warn ? " ⚠️" : ""}] START  active=${_active} peak=${_peak}  ${label}`
  );
  const t0 = Date.now();

  return function done() {
    _active = Math.max(0, _active - 1);
    console.log(
      `[REQ] END    active=${_active}  ${label}  (${Date.now() - t0}ms)`
    );
  };
}

export function activeRequests() {
  return _active;
}
