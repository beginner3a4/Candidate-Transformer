'use strict';

/**
 * Known company aliases — maps common variants to a canonical name.
 * Keys are lowercase. Extend freely; no code changes required.
 */
const COMPANY_ALIASES = {
  'google llc':              'Google',
  'google inc':              'Google',
  'google inc.':             'Google',
  'alphabet':                'Google',
  'alphabet inc':            'Google',
  'meta platforms':          'Meta',
  'meta platforms inc':      'Meta',
  'facebook':                'Meta',
  'facebook inc':            'Meta',
  'amazon web services':     'AWS',
  'amazon.com':              'Amazon',
  'amazon.com inc':          'Amazon',
  'microsoft corporation':   'Microsoft',
  'microsoft corp':          'Microsoft',
  'apple inc':               'Apple',
  'apple inc.':              'Apple',
  'netflix inc':             'Netflix',
  'netflix inc.':            'Netflix',
  'salesforce.com':          'Salesforce',
  'salesforce.com inc':      'Salesforce',
  'salesforce inc':          'Salesforce',
  'twitter inc':             'X (Twitter)',
  'twitter':                 'X (Twitter)',
  'x corp':                  'X (Twitter)',
  'uber technologies':       'Uber',
  'uber technologies inc':   'Uber',
  'lyft inc':                'Lyft',
  'airbnb inc':              'Airbnb',
  'snap inc':                'Snap',
  'snapchat':                'Snap',
  'linkedin corporation':    'LinkedIn',
  'linkedin corp':           'LinkedIn',
  'intl business machines':  'IBM',
  'ibm corporation':         'IBM',
  'ibm corp':                'IBM',
  'oracle corporation':      'Oracle',
  'oracle corp':             'Oracle',
  'deloitte consulting':     'Deloitte',
  'accenture plc':           'Accenture',
  'mckinsey & company':      'McKinsey',
  'mckinsey and company':    'McKinsey',
};

/**
 * Legal suffix patterns to strip before alias lookup.
 */
const LEGAL_SUFFIXES = /\s*\b(inc\.?|llc\.?|ltd\.?|corp\.?|corporation|co\.?|plc\.?|gmbh|s\.a\.?|pvt\.?|private limited|limited)\s*$/i;

/**
 * Normalize a company name string.
 * - Strips common legal suffixes for alias lookup
 * - Checks alias map
 * - Falls back to title-cased original (trimmed)
 * Returns null for empty input.
 *
 * @param {string|null} raw
 * @returns {string|null}
 */
function normalizeCompany(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();

  // Direct alias match
  if (COMPANY_ALIASES[lower]) return COMPANY_ALIASES[lower];

  // Strip legal suffix and try again
  const stripped = trimmed.replace(LEGAL_SUFFIXES, '').trim();
  const strippedLower = stripped.toLowerCase();
  if (COMPANY_ALIASES[strippedLower]) return COMPANY_ALIASES[strippedLower];

  // No alias — return trimmed original (preserve casing)
  return trimmed;
}

/**
 * Return true if two company name strings refer to the same entity.
 *
 * @param {string|null} a
 * @param {string|null} b
 * @returns {boolean}
 */
function companiesMatch(a, b) {
  if (!a || !b) return false;
  return normalizeCompany(a) === normalizeCompany(b);
}

module.exports = { normalizeCompany, companiesMatch, COMPANY_ALIASES };
