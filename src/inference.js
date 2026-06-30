'use strict';

const { normalizeCountry }          = require('./normalizers/countryNormalizer');
const { countryFromPhone, normalizePhone, regionFromCountry } = require('./normalizers/phoneNormalizer');
const { inferCountryFromCity }      = require('./normalizers/locationNormalizer');
const { extractGithubUsername }     = require('./normalizers/urlNormalizer');
const { normalizeCompany }          = require('./normalizers/companyNormalizer');
const { durationYears, isOngoing }  = require('./normalizers/dateNormalizer');

/**
 * INFERENCE_CONFIDENCE_PENALTY — applied to all inferred values.
 * Inferred values are less trustworthy than directly extracted ones.
 */
const INFERENCE_CONFIDENCE_PENALTY = 0.3;

/**
 * Run all inference rules over a merged canonical profile.
 * Each rule may add or update a field, always with reduced confidence and clear provenance.
 *
 * Rules applied (in order):
 *  1. PHONE_COUNTRY_FROM_LOCATION  — infer phone country code from known country
 *  2. LOCATION_FROM_PHONE          — infer country from phone country code
 *  3. LOCATION_FROM_CITY           — infer country from known city names
 *  4. GITHUB_USERNAME_FROM_URL     — extract username from GitHub URL
 *  5. YEARS_FROM_EMPLOYMENT        — derive years_experience from work history dates
 *  6. COMPANY_ALIAS_NORMALIZE      — normalize company names in experience
 *  7. ONGOING_EMPLOYMENT_DETECT    — flag null-end roles as ongoing
 *
 * @param {object} canonical - the merged canonical profile (mutated in-place)
 * @param {object} opts
 * @param {string[]} [opts.inferredFields=[]] - accumulator; rule names appended on inference
 * @returns {{ canonical: object, inferredFields: string[], inferenceLog: object[] }}
 */
function runInference(canonical, opts = {}) {
  const inferredFields = opts.inferredFields || [];
  const inferenceLog   = [];

  function record(rule, field, from, to, confidence) {
    inferredFields.push(field);
    inferenceLog.push({ rule, field, from, to, confidence });

    // Attach to provenance
    canonical.provenance = canonical.provenance || [];
    canonical.provenance.push({
      field,
      source:         'inference',
      method:         rule,
      loader:         null,
      extraction:     null,
      normalization:  null,
      inference_rule: rule,
      merge_decision: null,
      confidence_score: confidence,
    });
  }

  // ── Rule 1: PHONE_COUNTRY_FROM_LOCATION ──────────────────────────────────
  // If we know the country but phones lack country codes, re-normalize with correct region.
  if (canonical.location && canonical.location.country && canonical.phones && canonical.phones.length > 0) {
    const country = canonical.location.country;
    const region  = regionFromCountry(country);

    if (region && region !== 'US') {
      const updatedPhones = canonical.phones.map(ph => {
        // Only re-try if it doesn't already start with a country prefix other than +1
        if (ph && !ph.startsWith('+1') && !ph.startsWith('+' + countryCallingCode(country))) {
          const re = normalizePhone(ph, region);
          return re || ph;
        }
        return ph;
      });
      if (JSON.stringify(updatedPhones) !== JSON.stringify(canonical.phones)) {
        record('PHONE_COUNTRY_FROM_LOCATION', 'phones',
          canonical.phones, updatedPhones,
          1 - INFERENCE_CONFIDENCE_PENALTY);
        canonical.phones = [...new Set(updatedPhones)];
      }
    }
  }

  // ── Rule 2: LOCATION_FROM_PHONE ───────────────────────────────────────────
  // If location.country is missing but we have a phone with a non-US country code.
  if (canonical.phones && canonical.phones.length > 0) {
    const needsCountry = !canonical.location || !canonical.location.country;
    if (needsCountry) {
      for (const ph of canonical.phones) {
        const inferred = countryFromPhone(ph);
        if (inferred && inferred !== 'US') {
          canonical.location = canonical.location || { city: null, region: null, country: null };
          const prev = canonical.location.country;
          canonical.location.country = inferred;
          record('LOCATION_FROM_PHONE', 'location.country', prev, inferred,
            1 - INFERENCE_CONFIDENCE_PENALTY);
          break;
        }
      }
    }
  }

  // ── Rule 3: LOCATION_FROM_CITY ────────────────────────────────────────────
  // If city is known but country is missing, try to infer country from city.
  if (canonical.location && canonical.location.city && !canonical.location.country) {
    const inferred = inferCountryFromCity(canonical.location.city);
    if (inferred) {
      const prev = canonical.location.country;
      canonical.location.country = inferred;
      record('LOCATION_FROM_CITY', 'location.country', prev, inferred,
        1 - INFERENCE_CONFIDENCE_PENALTY);
    }
  }

  // ── Rule 4: GITHUB_USERNAME_FROM_URL ─────────────────────────────────────
  // Extract the GitHub username from the stored GitHub URL.
  if (canonical.links && canonical.links.github) {
    const username = extractGithubUsername(canonical.links.github);
    if (username) {
      const prev = canonical.links.github_username;
      canonical.links.github_username = username;
      if (username !== prev) {
        record('GITHUB_USERNAME_FROM_URL', 'links.github_username', prev, username,
          1 - INFERENCE_CONFIDENCE_PENALTY);
      }
    }
  }

  // ── Rule 5: YEARS_FROM_EMPLOYMENT ────────────────────────────────────────
  // Derive years_experience from the sum of non-overlapping experience durations.
  // Only applied when years_experience is null/0 or is only from an inferred source.
  const fromEmployment = deriveYearsFromExperience(canonical.experience || []);
  if (fromEmployment !== null) {
    const prev = canonical.years_experience;
    // Only override if missing; never reduce a higher value from a direct source
    if (prev === null || prev === undefined || prev === 0) {
      canonical.years_experience = fromEmployment;
      record('YEARS_FROM_EMPLOYMENT', 'years_experience', prev, fromEmployment,
        1 - INFERENCE_CONFIDENCE_PENALTY);
    }
  }

  // ── Rule 6: COMPANY_ALIAS_NORMALIZE ──────────────────────────────────────
  // Normalize company names in experience using alias map.
  if (canonical.experience && canonical.experience.length > 0) {
    let changed = false;
    const normalized = canonical.experience.map(exp => {
      if (!exp.company) return exp;
      const normalized = normalizeCompany(exp.company);
      if (normalized !== exp.company) {
        changed = true;
        return { ...exp, company: normalized };
      }
      return exp;
    });

    if (changed) {
      canonical.experience = normalized;
      record('COMPANY_ALIAS_NORMALIZE', 'experience[].company',
        '(multiple)', '(normalized)', 1 - INFERENCE_CONFIDENCE_PENALTY);
    }
  }

  // ── Rule 7: ONGOING_EMPLOYMENT_DETECT ────────────────────────────────────
  // Mark roles with null end dates as ongoing = true.
  if (canonical.experience && canonical.experience.length > 0) {
    let changed = false;
    const withOngoing = canonical.experience.map(exp => {
      if (exp.ongoing === null || exp.ongoing === undefined) {
        const flagOngoing = exp.end === null;
        if (flagOngoing !== exp.ongoing) {
          changed = true;
          return { ...exp, ongoing: flagOngoing };
        }
      }
      return exp;
    });

    if (changed) {
      canonical.experience = withOngoing;
      record('ONGOING_EMPLOYMENT_DETECT', 'experience[].ongoing',
        'null', 'boolean', 1 - INFERENCE_CONFIDENCE_PENALTY);
    }
  }

  return { canonical, inferredFields, inferenceLog };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Sum the duration of experience entries.
 * Uses durationYears(); returns null if no dated entries found.
 *
 * @param {object[]} experience
 * @returns {number|null} total years (rounded to 1 dp) or null
 */
function deriveYearsFromExperience(experience) {
  if (!experience || experience.length === 0) return null;

  let totalMonths = 0;
  let hasDates = false;

  for (const exp of experience) {
    if (!exp.start) continue;
    hasDates = true;
    const years = durationYears(exp.start, exp.end || null);
    totalMonths += Math.round(years * 12);
  }

  if (!hasDates) return null;
  return parseFloat((totalMonths / 12).toFixed(1));
}

/**
 * Look up the country calling code (as string, e.g. "91") for an ISO alpha-2 code.
 * Lightweight — only used to avoid false re-normalization.
 *
 * @param {string} alpha2
 * @returns {string}
 */
function countryCallingCode(alpha2) {
  const MAP = {
    IN: '91', GB: '44', DE: '49', FR: '33', JP: '81', CN: '86',
    AU: '61', CA: '1',  BR: '55', MX: '52', KR: '82', SG: '65',
    AE: '971', PK: '92', NG: '234', ZA: '27', AR: '54',
  };
  return MAP[alpha2] || '';
}

module.exports = { runInference, deriveYearsFromExperience, INFERENCE_CONFIDENCE_PENALTY };
