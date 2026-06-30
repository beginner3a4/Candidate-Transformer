'use strict';

const { normalizeCountry } = require('./countryNormalizer');

/**
 * Known city aliases (lowercase) → canonical city name.
 */
const CITY_ALIASES = {
  'sf':          'San Francisco',
  's.f.':        'San Francisco',
  'san francisco bay area': 'San Francisco',
  'bay area':    'San Francisco',
  'la':          'Los Angeles',
  'l.a.':        'Los Angeles',
  'nyc':         'New York',
  'new york city': 'New York',
  'n.y.c.':      'New York',
  'dc':          'Washington D.C.',
  'washington dc': 'Washington D.C.',
  'wash dc':     'Washington D.C.',
  'chi':         'Chicago',
  'london uk':   'London',
  'bengaluru':   'Bangalore',
  'blr':         'Bangalore',
  'bombay':      'Mumbai',
  'calcutta':    'Kolkata',
  'madras':      'Chennai',
};

/**
 * Normalize a location object.
 * Standardizes city aliases, normalizes country to ISO-3166 alpha-2.
 *
 * @param {{ city?: string, region?: string, country?: string }|null} raw
 * @returns {{ city: string|null, region: string|null, country: string|null }|null}
 */
function normalizeLocation(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const city    = normalizeCity(raw.city);
  const region  = raw.region ? raw.region.trim() || null : null;
  const country = normalizeCountry(raw.country);

  if (!city && !region && !country) return null;
  return { city, region, country };
}

/**
 * Normalize a city string: trim, alias lookup, title-case fallback.
 *
 * @param {string|null} raw
 * @returns {string|null}
 */
function normalizeCity(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();
  if (CITY_ALIASES[lower]) return CITY_ALIASES[lower];

  // Title-case
  return trimmed.replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Attempt to infer country from a city or location string.
 * Returns null if city is not in the alias map or known set.
 *
 * @param {string|null} city
 * @returns {string|null} ISO-3166 alpha-2 or null
 */
function inferCountryFromCity(city) {
  if (!city) return null;

  // Known US cities
  const US_CITIES = new Set([
    'san francisco', 'los angeles', 'new york', 'chicago', 'seattle',
    'austin', 'boston', 'denver', 'miami', 'atlanta', 'dallas', 'houston',
    'washington d.c.', 'washington dc', 'portland', 'minneapolis',
    'san jose', 'san diego', 'phoenix', 'las vegas',
  ]);

  // Known Indian cities
  const IN_CITIES = new Set([
    'bangalore', 'bengaluru', 'mumbai', 'delhi', 'new delhi', 'hyderabad',
    'chennai', 'kolkata', 'pune', 'ahmedabad', 'jaipur', 'lucknow',
  ]);

  const lower = city.toLowerCase().trim();
  if (US_CITIES.has(lower)) return 'US';
  if (IN_CITIES.has(lower)) return 'IN';

  return null;
}

module.exports = { normalizeLocation, normalizeCity, inferCountryFromCity };
