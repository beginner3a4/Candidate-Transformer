'use strict';

const { SOURCE_TRUST } = require('./merger');

/**
 * Required fields — missing ones heavily penalise the score.
 */
const REQUIRED_FIELDS = ['full_name', 'emails', 'phones'];

/**
 * Important optional fields — missing ones moderately penalise the score.
 */
const IMPORTANT_FIELDS = [
  'headline', 'years_experience', 'skills', 'experience', 'education', 'location',
];

/**
 * Compute structured confidence for a merged canonical profile.
 *
 * Returns an object:
 * {
 *   score:       0–1,
 *   explanation: string,
 *   factors: [
 *     { factor: string, contribution: number, detail: string|null }
 *   ]
 * }
 *
 * @param {object}   canonical - merged canonical profile
 * @param {object[]} partials  - original partial profiles
 * @returns {object} canonical with confidence filled in
 */
function computeConfidence(canonical, partials) {
  const provenance   = canonical.provenance || [];
  const totalSources = new Set(partials.map(p => p.source)).size;
  const factors      = [];

  // Build field → sources map from provenance
  const fieldSources = {};
  for (const prov of provenance) {
    fieldSources[prov.field] = (prov.source || '')
      .split(', ')
      .map(s => s.trim())
      .filter(Boolean);
  }

  // ── Factor 1: Source Authority ────────────────────────────────────────────
  const sourcesPresent    = partials.map(p => p.source);
  const avgSourceTrust    = sourcesPresent.length > 0
    ? sourcesPresent.reduce((s, src) => s + (SOURCE_TRUST[src] ?? 0.5), 0) / sourcesPresent.length
    : 0;
  const maxSourceTrust    = sourcesPresent.reduce((m, src) => Math.max(m, SOURCE_TRUST[src] ?? 0), 0);

  factors.push({
    factor:       'source_authority',
    contribution: parseFloat((avgSourceTrust * 0.25).toFixed(4)),
    detail:       `Sources: ${sourcesPresent.join(', ')}; avg trust=${avgSourceTrust.toFixed(2)}, max=${maxSourceTrust.toFixed(2)}`,
  });

  // ── Factor 2: Source Coverage ─────────────────────────────────────────────
  const coverage = Math.min(sourcesPresent.length / 3, 1); // 3+ sources = full credit
  factors.push({
    factor:       'source_coverage',
    contribution: parseFloat((coverage * 0.10).toFixed(4)),
    detail:       `${sourcesPresent.length} source(s) provided`,
  });

  // ── Factor 3: Required Fields Completeness ────────────────────────────────
  const requiredScores = REQUIRED_FIELDS.map(field => {
    const val     = canonical[field];
    const isEmpty = isEmptyValue(val);
    return isEmpty ? 0.0 : 1.0;
  });
  const requiredScore = requiredScores.reduce((a, b) => a + b, 0) / REQUIRED_FIELDS.length;
  factors.push({
    factor:       'required_fields_completeness',
    contribution: parseFloat((requiredScore * 0.30).toFixed(4)),
    detail:       `${REQUIRED_FIELDS.filter((f, i) => requiredScores[i] === 1).join(', ')} present; missing: ${REQUIRED_FIELDS.filter((f, i) => requiredScores[i] === 0).join(', ') || 'none'}`,
  });

  // ── Factor 4: Important Fields Completeness ────────────────────────────────
  const importantScores = IMPORTANT_FIELDS.map(field => {
    const val = canonical[field];
    return isEmptyValue(val) ? 0.0 : 0.5;
  });
  const importantScore = importantScores.reduce((a, b) => a + b, 0) / IMPORTANT_FIELDS.length;
  factors.push({
    factor:       'optional_fields_completeness',
    contribution: parseFloat((importantScore * 0.15).toFixed(4)),
    detail:       `${importantScores.filter(s => s > 0).length}/${IMPORTANT_FIELDS.length} important fields present`,
  });

  // ── Factor 5: Skills Corroboration ────────────────────────────────────────
  if (canonical.skills && canonical.skills.length > 0) {
    const avgSkillConf = canonical.skills.reduce((s, sk) => s + sk.confidence, 0)
      / canonical.skills.length;
    factors.push({
      factor:       'skills_corroboration',
      contribution: parseFloat((avgSkillConf * 0.10).toFixed(4)),
      detail:       `${canonical.skills.length} skills; avg confidence=${avgSkillConf.toFixed(2)}`,
    });
  } else {
    factors.push({
      factor:       'skills_corroboration',
      contribution: 0,
      detail:       'No skills found',
    });
  }

  // ── Factor 6: Inference penalty ───────────────────────────────────────────
  const inferredCount = (canonical.inferred_fields || []).length;
  const inferPenalty  = Math.min(inferredCount * 0.02, 0.10);
  if (inferredCount > 0) {
    factors.push({
      factor:       'inference_penalty',
      contribution: parseFloat((-inferPenalty).toFixed(4)),
      detail:       `${inferredCount} inferred field(s) reduce confidence`,
    });
  }

  // ── Aggregate score ───────────────────────────────────────────────────────
  const rawScore = factors.reduce((s, f) => s + f.contribution, 0);
  const score    = parseFloat(Math.min(1, Math.max(0, rawScore)).toFixed(3));

  // ── Human-readable explanation ────────────────────────────────────────────
  const explanation = buildExplanation(score, sourcesPresent, requiredScores, importantScores);

  canonical.confidence = { score, explanation, factors };
  return canonical;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function isEmptyValue(v) {
  if (v === null || v === undefined) return true;
  if (Array.isArray(v))  return v.length === 0;
  if (typeof v === 'object') return Object.keys(v).every(k => v[k] === null || v[k] === undefined);
  return false;
}

function buildExplanation(score, sources, requiredScores, importantScores) {
  const missingRequired = REQUIRED_FIELDS.filter((_, i) => requiredScores[i] === 0);
  const importantPresent = importantScores.filter(s => s > 0).length;

  if (score >= 0.85) {
    return `Very high confidence. Sources: ${sources.join(', ')}. All required fields present.`;
  }
  if (score >= 0.70) {
    return `High confidence. Sources: ${sources.join(', ')}. ${importantPresent}/${IMPORTANT_FIELDS.length} important fields present.`;
  }
  if (score >= 0.50) {
    const issues = missingRequired.length > 0
      ? `Missing required: ${missingRequired.join(', ')}.`
      : `Limited corroboration across sources.`;
    return `Moderate confidence. ${issues} Sources: ${sources.join(', ')}.`;
  }
  if (score >= 0.30) {
    return `Low confidence. Missing required fields: ${missingRequired.join(', ') || 'none'}. Only ${sources.length} source(s).`;
  }
  return `Very low confidence. Profile is largely incomplete. Review source data.`;
}

module.exports = { computeConfidence };
