'use strict';

const LoaderRegistry = require('./loaders/registry');
const AtsLoader      = require('./loaders/AtsLoader');
const CsvLoader      = require('./loaders/CsvLoader');
const ResumeLoader   = require('./loaders/ResumeLoader');
const NotesLoader    = require('./loaders/NotesLoader');
const GitHubLoader   = require('./loaders/GitHubLoader');

const { merge }             = require('./merger');
const { runInference }      = require('./inference');
const { computeConfidence } = require('./confidence');
const { validate }          = require('./validator');
const { project }           = require('./projector');
const Metrics               = require('./metrics');
const logger                = require('./utils/logger');

/**
 * Build and return the default loader registry.
 */
function buildRegistry() {
  const registry = new LoaderRegistry();
  registry.register('ats',    AtsLoader);
  registry.register('csv',    CsvLoader);
  registry.register('resume', ResumeLoader);
  registry.register('notes',  NotesLoader);
  registry.register('github', GitHubLoader);
  return registry;
}

const DEFAULT_REGISTRY = buildRegistry();

/**
 * Run the full transformation pipeline.
 *
 * Stage 1  · LOAD            — loader registry dispatches sources concurrently
 * Stage 2  · EXTRACT         — each loader produces a PartialProfile
 * Stage 3  · NORMALIZE       — happens inside each loader + merger helpers
 * Stage 4  · INFER           — inference engine enriches merged profile
 * Stage 5  · MATCH           — candidate identity matching (groups partials)
 * Stage 6  · MERGE           — evidence-based resolution → CanonicalProfile
 * Stage 7  · CONFIDENCE      — structured confidence scoring
 * Stage 8  · VALIDATE        — schema + soft-warning validation
 * Stage 9  · PROJECT         — runtime-configurable output reshape
 * Stage 10 · EXPORT          — returned to caller
 *
 * @param {object}  sources  - { ats?, csv?, resume?, notes?, github? }
 * @param {object}  [config] - output projection config
 * @param {object}  [opts]
 * @returns {Promise<PipelineResult>}
 */
async function run(sources = {}, config = null, opts = {}) {
  const {
    registry       = DEFAULT_REGISTRY,
    strict         = false,
    dryRun         = false,
    collectMetrics = true,
  } = opts;

  const metrics = collectMetrics ? new Metrics() : null;
  if (metrics) metrics.startTimer('total');

  logger.info('Pipeline starting', { sources: Object.keys(sources).filter(k => sources[k]) });

  // ── Stage 1+2: Load + Extract ─────────────────────────────────────────────
  if (metrics) metrics.startTimer('load');
  const { partials, outcomes } = await registry.loadAll(sources, { metrics });
  if (metrics) metrics.stopTimer('load');

  if (partials.length === 0) {
    if (metrics) metrics.stopTimer('total');
    throw new Error('All sources failed or were empty — no data to process');
  }

  logger.info(`Loaded ${partials.length} partial(s) from: ${[...new Set(partials.map(p => p.source))].join(', ')}`);

  // ── Stage 5: Match ────────────────────────────────────────────────────────
  if (metrics) metrics.startTimer('match');
  const groups = matchCandidates(partials);
  if (metrics) metrics.stopTimer('match');

  logger.info(`Matching produced ${groups.length} candidate group(s)`);

  // ── Process each candidate group ─────────────────────────────────────────
  const results = [];
  for (const group of groups) {
    const result = await processGroup(group, config, { metrics, strict, dryRun });
    results.push(result);
  }

  if (metrics) metrics.stopTimer('total');
  const metricsReport = metrics ? metrics.report() : null;

  // Single candidate: unwrap
  if (results.length === 1) {
    return { ...results[0], metrics: metricsReport };
  }

  // Multi-candidate: return array + primary = highest-confidence result
  const primary = results.reduce((best, r) =>
    (r.canonical?.confidence?.score ?? 0) > (best.canonical?.confidence?.score ?? 0) ? r : best,
    results[0]
  );

  return {
    ...primary,
    metrics:          metricsReport,
    allResults:       results,
    candidateCount:   results.length,
  };
}

/**
 * Process one candidate group: merge → infer → confidence → validate → project.
 */
async function processGroup(partials, config, opts = {}) {
  const { metrics, strict, dryRun } = opts;

  // ── Stage 6: Merge ────────────────────────────────────────────────────────
  if (metrics) metrics.startTimer('merge');
  let canonical;
  try {
    canonical = merge(partials, { metrics });
  } catch (err) {
    throw new Error(`Merge failed: ${err.message}`);
  }
  if (metrics) metrics.stopTimer('merge');

  // ── Stage 4 (post-merge): Infer ───────────────────────────────────────────
  if (metrics) metrics.startTimer('infer');
  const { canonical: enriched, inferredFields } = runInference(canonical);
  enriched.inferred_fields = inferredFields;
  if (metrics) {
    metrics.stopTimer('infer');
    metrics.increment('inferredFields', inferredFields.length);
  }

  // ── Stage 7: Confidence ───────────────────────────────────────────────────
  if (metrics) metrics.startTimer('confidence');
  const withConfidence = computeConfidence(enriched, partials);
  if (metrics) metrics.stopTimer('confidence');

  logger.info('Merged canonical profile', {
    candidate_id:     withConfidence.candidate_id,
    confidence_score: withConfidence.confidence?.score,
    emails:           withConfidence.emails.length,
    skills:           withConfidence.skills.length,
    experience_roles: withConfidence.experience.length,
    inferred_fields:  inferredFields.length,
  });

  // ── Stage 8: Validate ─────────────────────────────────────────────────────
  if (metrics) metrics.startTimer('validate');
  const validationResult = validate(withConfidence, 'canonical', { strict });
  if (metrics) {
    metrics.stopTimer('validate');
    metrics.increment('validationErrors', validationResult.errors.length);
    metrics.increment('warnings', validationResult.warnings.length);
  }

  if (!validationResult.valid) {
    logger.warn('Canonical schema validation errors (pipeline continues unless strict mode)', {
      errors: validationResult.errors.map(e => e.message),
    });
  }

  if (dryRun) {
    logger.info('Dry-run mode: skipping project + export stages');
    return { output: null, canonical: withConfidence, validationResult };
  }

  // ── Stage 9: Project ──────────────────────────────────────────────────────
  if (metrics) metrics.startTimer('project');
  let output;
  try {
    output = project(withConfidence, config);
  } catch (err) {
    throw err;
  }
  if (metrics) metrics.stopTimer('project');

  logger.info('Pipeline complete');
  return { output, canonical: withConfidence, validationResult };
}

/**
 * Match partials into candidate groups using weighted multi-signal matching.
 *
 * Matching signals (weighted):
 *   email (exact)          — weight 1.0  (strongest identifier)
 *   phone (E.164 exact)    — weight 0.9
 *   github URL (exact)     — weight 0.85
 *   linkedin URL (exact)   — weight 0.85
 *   normalized name (fuzzy)— weight 0.5  (weak — requires corroboration)
 *
 * Two partials are the same candidate when their combined match score ≥ MATCH_THRESHOLD.
 * Name-only matches are rejected (require at least one strong signal).
 */
function matchCandidates(partials) {
  const MATCH_THRESHOLD = 0.85;

  if (partials.length <= 1) return [partials];

  const parent = partials.map((_, i) => i);

  function find(i) {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  }

  function union(i, j) {
    parent[find(i)] = find(j);
  }

  for (let i = 0; i < partials.length; i++) {
    for (let j = i + 1; j < partials.length; j++) {
      const { score, hasStrongSignal } = matchScore(partials[i], partials[j]);
      // Never merge on name alone — require at least one strong signal
      if (score >= MATCH_THRESHOLD && hasStrongSignal) {
        union(i, j);
      }
    }
  }

  const groupMap = new Map();
  for (let i = 0; i < partials.length; i++) {
    const root = find(i);
    if (!groupMap.has(root)) groupMap.set(root, []);
    groupMap.get(root).push(partials[i]);
  }

  return [...groupMap.values()];
}

/**
 * Compute a match decision between two partial profiles.
 *
 * Signals are normalised before comparison so that format differences
 * (e.g. "+1-737-555-0183" vs "(737) 555-0183", "www.linkedin.com" vs
 * "linkedin.com") do not cause false negatives.
 *
 * Decision rules:
 *   2+ strong signal matches               → same candidate (score 1.0)
 *   1  strong signal match + name match    → same candidate (score 0.9)
 *   1  strong signal match only            → probably same  (score 0.75)
 *   name match only                        → rejected (score 0.3, no strong signal)
 *
 * MATCH_THRESHOLD = 0.85, so only the first two cases produce a merge.
 *
 * Returns { score: 0–1, hasStrongSignal: boolean }
 */
function matchScore(a, b) {
  let strongMatches = 0;
  let hasStrongSignal = false;

  // Email (exact after lowercase+trim)
  const aEmails = new Set((a.data.emails || []).map(e => e.toLowerCase().trim()));
  const bEmails = new Set((b.data.emails || []).map(e => e.toLowerCase().trim()));
  if (aEmails.size > 0 && bEmails.size > 0 && [...aEmails].some(e => bEmails.has(e))) {
    strongMatches++;
    hasStrongSignal = true;
  }

  // Phone (normalised to last-10 digits so format variations match)
  const aPhones = new Set((a.data.phones || []).map(normalizePhoneDigits).filter(Boolean));
  const bPhones = new Set((b.data.phones || []).map(normalizePhoneDigits).filter(Boolean));
  if (aPhones.size > 0 && bPhones.size > 0 && [...aPhones].some(p => bPhones.has(p))) {
    strongMatches++;
    hasStrongSignal = true;
  }

  // GitHub URL (strip protocol + www, lowercase)
  const aGh = normalizeProfileUrl(a.data.links?.github);
  const bGh = normalizeProfileUrl(b.data.links?.github);
  if (aGh && bGh && aGh === bGh) {
    strongMatches++;
    hasStrongSignal = true;
  }

  // LinkedIn URL (strip protocol + www, lowercase)
  const aLi = normalizeProfileUrl(a.data.links?.linkedin);
  const bLi = normalizeProfileUrl(b.data.links?.linkedin);
  if (aLi && bLi && aLi === bLi) {
    strongMatches++;
    hasStrongSignal = true;
  }

  // Name (weak signal — never sufficient alone)
  const aName = normalizeName(a.data.full_name);
  const bName = normalizeName(b.data.full_name);
  const nameMatch = aName && bName && aName === bName;

  if (strongMatches >= 2)                  return { score: 1.0, hasStrongSignal: true };
  if (strongMatches >= 1 && nameMatch)     return { score: 0.9, hasStrongSignal: true };
  if (strongMatches >= 1)                  return { score: 0.75, hasStrongSignal: true };
  if (nameMatch)                           return { score: 0.3, hasStrongSignal: false };
  return { score: 0, hasStrongSignal: false };
}

/** Strip all non-digit characters and return the last 10 digits (local number). */
function normalizePhoneDigits(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length < 7) return null;
  return digits.slice(-10);
}

/** Strip protocol, www prefix, and trailing slash. Lowercase. */
function normalizeProfileUrl(url) {
  if (!url) return null;
  return String(url)
    .toLowerCase()
    .replace(/^https?:\/\/(www\.)?/, '')
    .replace(/\/$/, '')
    .trim();
}

function normalizeName(name) {
  if (!name) return null;
  return name.toLowerCase().replace(/\s+/g, ' ').trim();
}

module.exports = { run, buildRegistry, matchCandidates, DEFAULT_REGISTRY };
