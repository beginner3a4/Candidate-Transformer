'use strict';

const chrono = require('chrono-node');
const dayjs  = require('dayjs');

const ONGOING_PATTERNS  = /^(present|current|now|ongoing|till\s+date|to\s+date|today)$/i;
const YEAR_ONLY         = /^\d{4}$/;
const ALREADY_NORMALIZED = /^\d{4}-\d{2}$/;
const MM_YYYY           = /^(\d{1,2})[\/\-](\d{4})$/;

/**
 * Return true if the raw string signals an ongoing/current role.
 *
 * @param {string|null} raw
 * @returns {boolean}
 */
function isOngoing(raw) {
  if (!raw || typeof raw !== 'string') return false;
  return ONGOING_PATTERNS.test(raw.trim());
}

/**
 * Normalize a date string to YYYY-MM format.
 * Returns null for unparseable or "present/current" values.
 * Never invents a value.
 *
 * @param {string|null} raw
 * @returns {string|null}
 */
function normalizeDate(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (ONGOING_PATTERNS.test(trimmed)) return null;
  if (ALREADY_NORMALIZED.test(trimmed)) return trimmed;
  if (YEAR_ONLY.test(trimmed)) return `${trimmed}-01`;

  const mmYyyy = trimmed.match(MM_YYYY);
  if (mmYyyy) {
    const month = String(parseInt(mmYyyy[1], 10)).padStart(2, '0');
    return `${mmYyyy[2]}-${month}`;
  }

  const isoFull = trimmed.match(/^(\d{4})-(\d{2})-\d{2}$/);
  if (isoFull) return `${isoFull[1]}-${isoFull[2]}`;

  try {
    const parsed = chrono.parseDate(trimmed);
    if (parsed) return dayjs(parsed).format('YYYY-MM');
  } catch (_) {}

  return null;
}

/**
 * Normalize a date range string (e.g. "March 2021 - Present").
 *
 * @param {string|null} raw
 * @returns {{ start: string|null, end: string|null, ongoing: boolean }}
 */
function normalizeDateRange(raw) {
  if (!raw || typeof raw !== 'string') return { start: null, end: null, ongoing: false };

  const parts = raw.split(/\s*(?:–|-|to)\s*/i);
  if (parts.length >= 2) {
    const endRaw = parts[1].trim();
    return {
      start:   normalizeDate(parts[0].trim()),
      end:     isOngoing(endRaw) ? null : normalizeDate(endRaw),
      ongoing: isOngoing(endRaw),
    };
  }

  return { start: normalizeDate(raw), end: null, ongoing: false };
}

/**
 * Calculate the duration in decimal years between two YYYY-MM strings.
 * If end is null, uses today.
 *
 * @param {string|null} start  - YYYY-MM
 * @param {string|null} end    - YYYY-MM or null (= now)
 * @returns {number} years (rounded to 1 decimal)
 */
function durationYears(start, end) {
  if (!start) return 0;
  const s = dayjs(start + '-01');
  const e = end ? dayjs(end + '-01') : dayjs();
  const months = e.diff(s, 'month');
  return Math.max(0, parseFloat((months / 12).toFixed(1)));
}

module.exports = { normalizeDate, normalizeDateRange, isOngoing, durationYears };
