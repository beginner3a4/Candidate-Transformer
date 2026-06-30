'use strict';

const { PhoneNumberUtil, PhoneNumberFormat } = require('google-libphonenumber');
const phoneUtil = PhoneNumberUtil.getInstance();

/**
 * Normalize a phone number to E.164 format.
 * Returns null for any input that cannot be parsed into a valid number.
 * Never invents a value.
 *
 * @param {string|null} raw
 * @param {string} [defaultRegion='US']
 * @returns {string|null}
 */
function normalizePhone(raw, defaultRegion = 'US') {
  if (!raw || typeof raw !== 'string') return null;
  const cleaned = raw.trim();
  if (!cleaned) return null;

  const stripped = cleaned.replace(/[^\d+\-() .x#]+/gi, '').trim();
  if (!stripped) return null;

  for (const attempt of [stripped, cleaned]) {
    try {
      const parsed = phoneUtil.parseAndKeepRawInput(attempt, defaultRegion);
      if (phoneUtil.isValidNumber(parsed)) {
        return phoneUtil.format(parsed, PhoneNumberFormat.E164);
      }
    } catch (_) {}
  }

  const digitsOnly = cleaned.replace(/\D/g, '');
  if (digitsOnly.length >= 10) {
    try {
      const parsed = phoneUtil.parseAndKeepRawInput(`+${digitsOnly}`, defaultRegion);
      if (phoneUtil.isValidNumber(parsed)) {
        return phoneUtil.format(parsed, PhoneNumberFormat.E164);
      }
    } catch (_) {}
  }

  return null;
}

/**
 * Infer the default region for phone parsing from an ISO-3166 alpha-2 country code.
 * Returns 'US' if country is unrecognized or null.
 *
 * @param {string|null} countryCode - ISO-3166 alpha-2 e.g. 'IN', 'GB'
 * @returns {string} region string for libphonenumber
 */
function regionFromCountry(countryCode) {
  if (!countryCode || typeof countryCode !== 'string') return 'US';
  const upper = countryCode.toUpperCase().trim();
  // libphonenumber uses the same alpha-2 codes as ISO-3166
  const supported = phoneUtil.getSupportedRegions();
  return supported.has ? (supported.has(upper) ? upper : 'US') : (supported.includes(upper) ? upper : 'US');
}

/**
 * Extract country code (e.g. 'US', 'IN') from a parsed E.164 number.
 * Returns null if the number cannot be parsed.
 *
 * @param {string} e164
 * @returns {string|null}
 */
function countryFromPhone(e164) {
  if (!e164) return null;
  try {
    const parsed  = phoneUtil.parse(e164, null);
    const regions = phoneUtil.getRegionCodesForCountryCode(parsed.getCountryCode());
    return regions && regions.length > 0 ? regions[0] : null;
  } catch (_) {
    return null;
  }
}

/**
 * Normalize an array of phone strings, deduplicating results.
 *
 * @param {string[]} raws
 * @param {string} [defaultRegion='US']
 * @returns {string[]}
 */
function normalizePhones(raws, defaultRegion = 'US') {
  const seen   = new Set();
  const result = [];
  for (const raw of (raws || [])) {
    const e164 = normalizePhone(raw, defaultRegion);
    if (e164 && !seen.has(e164)) {
      seen.add(e164);
      result.push(e164);
    }
  }
  return result;
}

module.exports = { normalizePhone, normalizePhones, regionFromCountry, countryFromPhone };
