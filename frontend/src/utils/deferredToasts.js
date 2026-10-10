/**
 * Toasts that must outlive a page reload.
 *
 * Some flows (import) reload the page as soon as they finish, which discards
 * the in-memory toast list before anyone can read it. Those flows queue their
 * messages here instead; the toast container shows them after the reload.
 * `sessionStorage` keeps the queue scoped to this tab and this session.
 */

export const DEFERRED_TOASTS_KEY = 'panino_deferred_toasts';

const TOAST_TYPES = new Set(['success', 'error', 'info', 'warning']);
const MAX_DEFERRED_TOASTS = 5;
const MAX_MESSAGE_LENGTH = 1000;
const DEFAULT_DURATION_MS = 5000;
const MAX_DURATION_MS = 60000;

function normalizeToast(toast) {
  if (!toast || typeof toast.message !== 'string' || toast.message.length === 0) return null;
  const duration = Number(toast.duration);
  return {
    message: toast.message.slice(0, MAX_MESSAGE_LENGTH),
    type: TOAST_TYPES.has(toast.type) ? toast.type : 'info',
    duration: Number.isFinite(duration) && duration > 0
      ? Math.min(duration, MAX_DURATION_MS)
      : DEFAULT_DURATION_MS,
  };
}

/**
 * Replace the queue with these toasts. Storage failures are ignored: losing a
 * message is preferable to failing the operation that produced it.
 *
 * @param {Pick<Storage, 'setItem'>} storage
 * @param {Array<{ message: string, type?: string, duration?: number }>} toasts
 * @returns {number} how many toasts were queued
 */
export function queueDeferredToasts(storage, toasts) {
  const queued = (toasts || []).map(normalizeToast).filter(Boolean).slice(0, MAX_DEFERRED_TOASTS);
  if (queued.length === 0) return 0;
  try {
    storage.setItem(DEFERRED_TOASTS_KEY, JSON.stringify(queued));
    return queued.length;
  } catch {
    return 0;
  }
}

/**
 * Return the queued toasts and clear the queue, so each is shown once.
 *
 * @param {Pick<Storage, 'getItem' | 'removeItem'>} storage
 * @returns {Array<{ message: string, type: string, duration: number }>}
 */
export function takeDeferredToasts(storage) {
  try {
    const raw = storage.getItem(DEFERRED_TOASTS_KEY);
    if (raw === null) return [];
    storage.removeItem(DEFERRED_TOASTS_KEY);
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeToast).filter(Boolean).slice(0, MAX_DEFERRED_TOASTS);
  } catch {
    return [];
  }
}
