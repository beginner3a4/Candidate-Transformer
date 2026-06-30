'use strict';

const { normalizePhone, normalizePhones } = require('./normalizers/phoneNormalizer');
const { normalizeDate }                   = require('./normalizers/dateNormalizer');
const { normalizeEmail, normalizeEmails } = require('./normalizers/emailNormalizer');
const { normalizeCountry }               = require('./normalizers/countryNormalizer');
const { normalizeCompany }               = require('./normalizers/companyNormalizer');
const { normalizeUrl, normalizeLinkedinUrl, normalizeGithubUrl } = require('./normalizers/urlNormalizer');
const { canonicalizeSkills }             = require('./normalizers/skillsNormalizer');
const { generateCandidateId }            = require('./utils/idGenerator');
const logger                             = require('./utils/logger');

/**
 * Source trust scores — used in evidence-based resolution.
 * Higher score = more trustworthy. Range 0–1.
 */
const SOURCE_TRUST = {
  ats:    1.00,
  csv:    0.85,
  resume: 0.70,
  github: 0.65,
  notes:  0.50,
};

const INFERRED_PENALTY = 0.30;

/**
 * Legal suffix regex — used to strip suffixes when building dedup keys.
 */
const LEGAL_SUFFIX_RE = /\s*\b(inc\.?|llc\.?|ltd\.?|corp\.?|corporation|co\.?|plc\.?|gmbh|s\.a\.?|pvt\.?|private limited|limited)\s*$/i;

/**
 * Merge an array of PartialProfiles into one CanonicalProfile.
 */
function merge(partials, opts = {}) {
  const { metrics } = opts;

  if (!partials || partials.length === 0) {
    throw new Error('No partial profiles to merge');
  }

  const sorted = [...partials].sort(
    (a, b) => (SOURCE_TRUST[b.source] ?? 0) - (SOURCE_TRUST[a.source] ?? 0)
  );

  const provenance  = [];
  const decisionLog = [];

  const trackConflict = (field) => {
    if (metrics) metrics.increment('mergeConflicts');
    logger.debug(`[Merger] conflict resolved for "${field}"`);
  };

  // ── Scalars ──────────────────────────────────────────────────────────────
  const full_name        = evidencePick(sorted, 'full_name',        provenance, decisionLog, { trackConflict });
  const headline         = evidencePick(sorted, 'headline',         provenance, decisionLog, { trackConflict });
  const years_experience = mergeYearsExperience(sorted, provenance, decisionLog, { metrics });

  // ── Lists ─────────────────────────────────────────────────────────────────
  const emails = mergeEmails(sorted, provenance, metrics);
  const phones = mergePhones(sorted, provenance, metrics);

  // ── Structured fields ────────────────────────────────────────────────────
  const location   = mergeLocation(sorted, provenance, metrics);
  const links      = mergeLinks(sorted, provenance, metrics);
  const skills     = mergeSkills(sorted, provenance, metrics);
  const experience = mergeExperience(sorted, provenance, metrics);
  const education  = mergeEducation(sorted, provenance, metrics);

  const candidate_id = generateCandidateId(emails, full_name);

  return {
    candidate_id,
    full_name,
    emails,
    phones,
    location,
    links,
    headline,
    years_experience,
    skills,
    experience,
    education,
    provenance,
    decision_log: decisionLog,
    inferred_fields: [],
    confidence: null,
  };
}

// ── Evidence score ────────────────────────────────────────────────────────────

function evidenceScore(source, value, corroborationCount, isInferred) {
  const trust      = SOURCE_TRUST[source] ?? 0.5;
  const corrBoost  = Math.min(corroborationCount * 0.1, 0.3);
  const completeness = value ? completenessScore(value) : 0;
  const penalty    = isInferred ? INFERRED_PENALTY : 0;
  return (trust + corrBoost + completeness * 0.1) - penalty;
}

function completenessScore(value) {
  if (!value) return 0;
  if (typeof value === 'string') return Math.min(value.length / 100, 1);
  if (Array.isArray(value)) return Math.min(value.length / 5, 1);
  if (typeof value === 'number') return value > 0 ? 0.5 : 0;
  return 0.5;
}

function evidencePick(sorted, field, provenance, decisionLog, opts = {}) {
  const { trackConflict } = opts;

  const candidates = sorted
    .map(p => ({
      source: p.source,
      value:  p.data[field],
      score:  evidenceScore(p.source, p.data[field], 0, false),
    }))
    .filter(c => c.value !== null && c.value !== undefined && c.value !== '');

  if (candidates.length === 0) return null;

  // Corroboration bonus
  for (const c of candidates) {
    c.score += (candidates.filter(x => x !== c && x.value === c.value).length * 0.1);
  }

  candidates.sort((a, b) => b.score - a.score);

  const winner       = candidates[0];
  const alternatives = candidates.slice(1);

  if (alternatives.length > 0) {
    if (trackConflict) trackConflict(field);
    decisionLog.push({
      field,
      selected:     { value: winner.value, source: winner.source, score: round3(winner.score) },
      alternatives: alternatives.map(a => ({ value: a.value, source: a.source, score: round3(a.score) })),
      reason:       'Highest evidence score (trust + corroboration + completeness)',
    });
  }

  provenance.push({
    field,
    source:          winner.source,
    method:          alternatives.length > 0 ? 'evidence-pick(conflict-resolved)' : 'evidence-pick',
    loader:          winner.source,
    extraction:      null,
    normalization:   null,
    inference_rule:  null,
    merge_decision:  alternatives.length > 0 ? `Selected over: ${alternatives.map(a => a.source).join(', ')}` : null,
    confidence_score: round3(winner.score),
  });

  return winner.value;
}

// ── Years of experience ──────────────────────────────────────────────────────

function mergeYearsExperience(sorted, provenance, decisionLog, opts = {}) {
  const { metrics } = opts;
  let max = null, maxSrc = null;
  const candidates = [];

  for (const p of sorted) {
    let val = p.data.years_experience;
    if (val === null || val === undefined) continue;
    val = Number(val);
    if (isNaN(val)) continue;

    // GitHub account age is not real experience — halve it
    if (p.source === 'github') val = Math.floor(val / 2);

    candidates.push({ source: p.source, value: val });
    if (max === null || val > max) { max = val; maxSrc = p.source; }
  }

  if (max === null) return null;

  if (candidates.length > 1) {
    if (metrics) metrics.increment('mergeConflicts');
    decisionLog.push({
      field:        'years_experience',
      selected:     { value: max, source: maxSrc },
      alternatives: candidates.filter(c => c.source !== maxSrc || c.value !== max),
      reason:       'Conservative max across sources; GitHub account age halved',
    });
  }

  provenance.push({
    field:           'years_experience',
    source:          maxSrc,
    method:          'max-across-sources(github-halved)',
    loader:          maxSrc,
    extraction:      null,
    normalization:   null,
    inference_rule:  null,
    merge_decision:  null,
    confidence_score: SOURCE_TRUST[maxSrc] ?? 0.5,
  });

  return max;
}

// ── Emails ────────────────────────────────────────────────────────────────────

function mergeEmails(sorted, provenance, metrics) {
  const seen    = new Set();
  const result  = [];
  const sources = [];

  for (const p of sorted) {
    const normalized = normalizeEmails(p.data.emails || []);
    if (metrics) metrics.increment('fieldsNormalized', normalized.length);
    for (const e of normalized) {
      if (!seen.has(e)) {
        seen.add(e);
        result.push(e);
        sources.push(p.source);
      }
    }
  }

  if (result.length > 0) {
    provenance.push({
      field:          'emails',
      source:         [...new Set(sources)].join(', '),
      method:         'normalize(lowercase)+union-dedup',
      loader:         null,
      extraction:     null,
      normalization:  ['lowercase', 'trim', 'validate-regex'],
      inference_rule: null,
      merge_decision: null,
      confidence_score: null,
    });
  }

  return result;
}

// ── Phones ────────────────────────────────────────────────────────────────────

function mergePhones(sorted, provenance, metrics) {
  const seen    = new Set();
  const result  = [];
  const sources = [];

  for (const p of sorted) {
    const normalized = normalizePhones(p.data.phones || []);
    if (metrics) metrics.increment('fieldsNormalized', normalized.length);
    for (const ph of normalized) {
      if (!seen.has(ph)) {
        seen.add(ph);
        result.push(ph);
        sources.push(p.source);
      }
    }
  }

  if (result.length > 0) {
    provenance.push({
      field:          'phones',
      source:         [...new Set(sources)].join(', '),
      method:         'normalize(E164)+union-dedup',
      loader:         null,
      extraction:     null,
      normalization:  ['E164', 'deduplicate'],
      inference_rule: null,
      merge_decision: null,
      confidence_score: null,
    });
  }

  return result;
}

// ── Location ──────────────────────────────────────────────────────────────────

function mergeLocation(sorted, provenance, metrics) {
  let city = null, region = null, country = null;
  let citySrc = null, regionSrc = null, countrySrc = null;

  for (const p of sorted) {
    const loc = p.data.location;
    if (!loc) continue;

    if (!city   && loc.city)   { city   = loc.city.trim();   citySrc   = p.source; }
    if (!region && loc.region) { region = loc.region.trim(); regionSrc = p.source; }
    if (!country && loc.country) {
      const code = normalizeCountry(loc.country);
      if (code) { country = code; countrySrc = p.source; }
      if (metrics) metrics.increment('fieldsNormalized');
    }
  }

  if (!city && !region && !country) return null;

  const srcSet = [...new Set([citySrc, regionSrc, countrySrc].filter(Boolean))];
  provenance.push({
    field:          'location',
    source:         srcSet.join(', '),
    method:         'priority-pick-per-subfield+normalize(ISO-3166-alpha2)',
    loader:         null,
    extraction:     null,
    normalization:  ['ISO-3166-alpha2'],
    inference_rule: null,
    merge_decision: null,
    confidence_score: null,
  });

  return { city, region, country };
}

// ── Links ─────────────────────────────────────────────────────────────────────

function mergeLinks(sorted, provenance, metrics) {
  let linkedin = null, github = null, portfolio = null;
  const other  = [];
  const sources = [];

  for (const p of sorted) {
    const l = p.data.links;
    if (!l) continue;
    sources.push(p.source);

    if (!linkedin  && l.linkedin) {
      linkedin  = normalizeLinkedinUrl(l.linkedin) || l.linkedin;
      if (metrics) metrics.increment('fieldsNormalized');
    }
    if (!github    && l.github) {
      github    = normalizeGithubUrl(l.github) || l.github;
      if (metrics) metrics.increment('fieldsNormalized');
    }
    if (!portfolio && l.portfolio) {
      portfolio = normalizeUrl(l.portfolio) || l.portfolio;
      if (metrics) metrics.increment('fieldsNormalized');
    }
    for (const u of (l.other || [])) {
      const nu = normalizeUrl(u);
      const final = nu || u;
      if (final && !other.includes(final)) other.push(final);
    }
  }

  if (!linkedin && !github && !portfolio && other.length === 0) return null;

  provenance.push({
    field:          'links',
    source:         [...new Set(sources)].join(', '),
    method:         'evidence-pick-per-subfield+normalize(URL)',
    loader:         null,
    extraction:     null,
    normalization:  ['URL-normalize', 'linkedin-canonical', 'github-canonical'],
    inference_rule: null,
    merge_decision: null,
    confidence_score: null,
  });

  return { linkedin, github, portfolio, other };
}

// ── Skills ────────────────────────────────────────────────────────────────────

function mergeSkills(sorted, provenance, metrics) {
  const skillMap = new Map(); // canonicalName → Set<source>

  for (const p of sorted) {
    const rawSkills = p.data.skills || [];
    const canonical = canonicalizeSkills(rawSkills);
    if (metrics) metrics.increment('fieldsNormalized', canonical.length);

    for (const skill of canonical) {
      if (!skillMap.has(skill)) skillMap.set(skill, new Set());
      skillMap.get(skill).add(p.source);
    }
  }

  if (skillMap.size === 0) return [];

  const totalSources = sorted.length;
  const result = [];

  for (const [name, srcs] of skillMap) {
    const sources   = [...srcs];
    const trustSum  = sources.reduce((s, src) => s + (SOURCE_TRUST[src] ?? 0.5), 0);
    const avgTrust  = trustSum / sources.length;
    const corrRatio = sources.length / totalSources;
    const confidence = round3(avgTrust * 0.7 + corrRatio * 0.3);
    result.push({ name, confidence, sources });
  }

  result.sort((a, b) => b.confidence - a.confidence || a.name.localeCompare(b.name));

  if (result.length > 0) {
    const allSources = [...new Set(result.flatMap(s => s.sources))];
    provenance.push({
      field:          'skills',
      source:         allSources.join(', '),
      method:         'canonicalize+union-dedup+evidence-corroboration',
      loader:         null,
      extraction:     null,
      normalization:  ['canonicalize', 'deduplicate'],
      inference_rule: null,
      merge_decision: null,
      confidence_score: null,
    });
  }

  return result;
}

// ── Experience ────────────────────────────────────────────────────────────────

function mergeExperience(sorted, provenance, metrics) {
  const seen = new Map(); // dedup key → entry

  for (const p of sorted) {
    for (const exp of (p.data.experience || [])) {
      const company = normalizeCompany((exp.company || '').trim()) || null;
      const title   = (exp.title   || '').trim() || null;
      const start   = normalizeDate(exp.start);
      const endRaw  = exp.end;
      const end     = normalizeDate(endRaw);
      const ongoing = exp.ongoing === true || endRaw === null || endRaw === undefined;
      const summary = (exp.summary || '').trim() || null;

      if (!company && !title) continue;

      // Use a suffix-stripped company name for dedup to handle "Inc", "LLC", etc.
      const companyDedup = stripSuffix(company || '');
      const key = `${companyDedup.toLowerCase()}|${(title || '').toLowerCase()}|${start || ''}`;

      if (!seen.has(key)) {
        seen.set(key, {
          company, title, start, end, ongoing, summary,
          _sources: [p.source],
          _trust:   SOURCE_TRUST[p.source] ?? 0.5,
        });
      } else {
        const existing = seen.get(key);
        const trust    = SOURCE_TRUST[p.source] ?? 0.5;

        // Prefer longer summary
        if (summary && (!existing.summary || summary.length > existing.summary.length)) {
          existing.summary = summary;
        }
        // Prefer known end date from higher-trust source
        if (end && (!existing.end || trust > existing._trust)) {
          existing.end     = end;
          existing.ongoing = false;
        }
        // Prefer explicit start date
        if (start && !existing.start) existing.start = start;

        existing._sources.push(p.source);
        if (trust > existing._trust) existing._trust = trust;
      }
    }
  }

  if (seen.size > 0) {
    const allSources = [...new Set([...seen.values()].flatMap(e => e._sources))];
    provenance.push({
      field:          'experience',
      source:         allSources.join(', '),
      method:         'union-dedup(company+title+start)+normalize(dates+company)',
      loader:         null,
      extraction:     null,
      normalization:  ['dates-YYYY-MM', 'company-alias', 'suffix-strip'],
      inference_rule: null,
      merge_decision: null,
      confidence_score: null,
    });
  }

  // Sort: ongoing first, then by start date descending
  const entries = [...seen.values()].map(({ _sources, _trust, ...e }) => e);
  entries.sort((a, b) => {
    if (a.ongoing && !b.ongoing) return -1;
    if (!a.ongoing && b.ongoing) return 1;
    if (a.start && b.start) return b.start.localeCompare(a.start);
    return 0;
  });

  return entries;
}

// ── Education ─────────────────────────────────────────────────────────────────

function mergeEducation(sorted, provenance, metrics) {
  const seen = new Map();

  for (const p of sorted) {
    for (const edu of (p.data.education || [])) {
      const institution = (edu.institution || '').trim();
      const degree      = (edu.degree      || '').trim() || null;
      const field       = (edu.field       || '').trim() || null;
      const end_year    = edu.end_year ? Number(edu.end_year) : null;

      if (!institution) continue;

      const key = `${institution.toLowerCase()}|${(degree || '').toLowerCase()}`;

      if (!seen.has(key)) {
        seen.set(key, { institution, degree, field, end_year, _sources: [p.source] });
      } else {
        const existing = seen.get(key);
        if (!existing.field    && field)    existing.field    = field;
        if (!existing.end_year && end_year) existing.end_year = end_year;
        existing._sources.push(p.source);
      }
    }
  }

  if (seen.size > 0) {
    const allSources = [...new Set([...seen.values()].flatMap(e => e._sources))];
    provenance.push({
      field:          'education',
      source:         allSources.join(', '),
      method:         'union-dedup(institution+degree)',
      loader:         null,
      extraction:     null,
      normalization:  null,
      inference_rule: null,
      merge_decision: null,
      confidence_score: null,
    });
  }

  return [...seen.values()].map(({ _sources, ...e }) => e);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function stripSuffix(name) {
  return name.replace(LEGAL_SUFFIX_RE, '').trim();
}

function round3(n) {
  return parseFloat(n.toFixed(3));
}

module.exports = { merge, SOURCE_TRUST, evidenceScore };
