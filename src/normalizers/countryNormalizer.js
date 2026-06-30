'use strict';

const isoCountries = require('i18n-iso-countries');

const MANUAL_MAP = {
  'usa':                    'US',
  'u.s.a.':                 'US',
  'u.s.':                   'US',
  'united states of america':'US',
  'united states':          'US',
  'uk':                     'GB',
  'u.k.':                   'GB',
  'great britain':          'GB',
  'england':                'GB',
  'uae':                    'AE',
  'u.a.e.':                 'AE',
  'united arab emirates':   'AE',
  'south korea':            'KR',
  'north korea':            'KP',
  'russia':                 'RU',
  'taiwan':                 'TW',
  'hong kong':              'HK',
  'macau':                  'MO',
  'iran':                   'IR',
  'syria':                  'SY',
  'vietnam':                'VN',
  'viet nam':               'VN',
  'czech republic':         'CZ',
  'czechia':                'CZ',
  'slovak republic':        'SK',
  'slovakia':               'SK',
};

/**
 * Normalize a country string to ISO-3166 alpha-2 code.
 * Returns null for unrecognised input. Never invents a value.
 *
 * @param {string|null} raw
 * @returns {string|null} alpha-2 e.g. 'US' or null
 */
function normalizeCountry(raw) {
  if (!raw || typeof raw !== 'string') return null;

  const trimmed = raw.trim();
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();

  if (MANUAL_MAP[lower]) return MANUAL_MAP[lower];

  if (/^[A-Za-z]{2}$/.test(trimmed)) {
    const code = trimmed.toUpperCase();
    if (isoCountries.isValid(code)) return code;
  }

  if (/^[A-Za-z]{3}$/.test(trimmed)) {
    const alpha2 = isoCountries.alpha3ToAlpha2(trimmed.toUpperCase());
    if (alpha2) return alpha2;
  }

  const alpha2 = isoCountries.getAlpha2Code(trimmed, 'en');
  if (alpha2) return alpha2;

  const titled = trimmed.replace(/\b\w/g, c => c.toUpperCase());
  const alpha2Titled = isoCountries.getAlpha2Code(titled, 'en');
  if (alpha2Titled) return alpha2Titled;

  return null;
}

module.exports = { normalizeCountry };
