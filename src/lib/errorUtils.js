/**
 * Returns a safe, user-facing error message. Never exposes raw error
 * internals (stack traces, SQL error details, network messages) to the UI.
 * The real error is still available for console logging at the call site.
 *
 * @param {unknown} _e       - The caught error (ignored; log it separately)
 * @param {string}  fallback - The message to show the user
 */
export function userErrorMessage(_e, fallback = 'Something went wrong. Please try again.') {
  return fallback;
}
