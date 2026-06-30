'use strict';

const EMAIL_RE = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;

/**
 * Normalize a single email address: trim, lowercase, validate.
 * Returns null for invalid input. Never invents a value.
 *
 * @param {string|null} raw
 * @returns {string|null}
 */
function normalizeEmail(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return null;
  if (!EMAIL_RE.test(normalized)) return null;
  return normalized;
}

/**
 * Normalize an array of email strings, removing invalid ones and deduplicating.
 *
 * @param {string[]} raws
 * @returns {string[]}
 */
function normalizeEmails(raws) {
  const seen   = new Set();
  const result = [];
  for (const raw of (raws || [])) {
    const email = normalizeEmail(raw);
    if (email && !seen.has(email)) {
      seen.add(email);
      result.push(email);
    }
  }
  return result;
}

module.exports = { normalizeEmail, normalizeEmails };
