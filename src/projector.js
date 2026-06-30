'use strict';

const { resolvePath }           = require('./utils/pathResolver');
const { normalizePhone }        = require('./normalizers/phoneNormalizer');
const { normalizeEmail }        = require('./normalizers/emailNormalizer');
const { normalizeUrl }          = require('./normalizers/urlNormalizer');
const { canonicalizeSkill }     = require('./normalizers/skillsNormalizer');
const { validateProjected }     = require('./validator');
const logger                    = require('./utils/logger');

/**
 * ProjectionEngine — reshapes a canonical profile according to a runtime config.
 *
 * Config shape:
 * {
 *   fields: [
 *     {
 *       path:       string,          // output field name
 *       from?:      string,          // canonical path expression (default = path)
 *       type?:      string,          // 'string' | 'number' | 'string[]' | etc.
 *       required?:  boolean,
 *       normalize?: 'E164' | 'EMAIL' | 'URL' | 'CANONICAL'
 *     }
 *   ],
 *   include_confidence: boolean,
 *   include_provenance: boolean,
 *   include_decision_log: boolean,
 *   on_missing: 'null' | 'omit' | 'error'
 * }
 *
 * If config.fields is empty or absent, the full canonical profile is returned
 * (modulo toggle flags).
 *
 * @param {object} canonical - validated canonical profile
 * @param {object} config    - output config (null = return full canonical)
 * @returns {object}
 */
function project(canonical, config) {
  if (!config || typeof config !== 'object') {
    return canonical;
  }

  const {
    fields               = [],
    include_confidence   = true,
    include_provenance   = true,
    include_decision_log = false,
    on_missing           = 'null',
  } = config;

  if (!fields || fields.length === 0) {
    return applyToggles(canonical, { include_confidence, include_provenance, include_decision_log });
  }

  const output = {};

  for (const def of fields) {
    const outputKey  = def.path;
    const sourcePath = def.from || def.path;

    let value = resolvePath(canonical, sourcePath);

    if (value !== null && value !== undefined) {
      value = applyNormalize(value, def.normalize);
    }

    if (value === undefined || value === null) {
      if (def.required && on_missing === 'error') {
        throw new MissingFieldError(outputKey, sourcePath);
      }
      if (on_missing === 'omit') continue;
      value = null;
    }

    output[outputKey] = value;
  }

  if (include_confidence) output.confidence      = canonical.confidence;
  if (include_provenance) output.provenance      = canonical.provenance;
  if (include_decision_log) output.decision_log  = canonical.decision_log;

  const { valid, errors, warnings } = validateProjected(output, fields, on_missing);
  if (!valid) errors.forEach(e => logger.warn(`[Projector] Validation error: ${e.message}`));
  if (warnings.length) warnings.forEach(w => logger.debug(`[Projector] ${w}`));

  return output;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function applyNormalize(value, normalize) {
  if (!normalize) return value;

  switch (normalize.toUpperCase()) {
    case 'E164':
      if (typeof value === 'string') return normalizePhone(value) ?? value;
      return value;

    case 'EMAIL':
      if (typeof value === 'string') return normalizeEmail(value) ?? value;
      return value;

    case 'URL':
      if (typeof value === 'string') return normalizeUrl(value) ?? value;
      return value;

    case 'CANONICAL':
      if (typeof value === 'string') return canonicalizeSkill(value) ?? value;
      if (Array.isArray(value))      return value.map(v => typeof v === 'string' ? (canonicalizeSkill(v) ?? v) : v);
      return value;

    default:
      logger.warn(`[Projector] Unknown normalize option: "${normalize}"`);
      return value;
  }
}

function applyToggles(canonical, flags) {
  const { include_confidence, include_provenance, include_decision_log } = flags;
  const out = { ...canonical };
  if (!include_confidence)   delete out.confidence;
  if (!include_provenance)   delete out.provenance;
  if (!include_decision_log) delete out.decision_log;
  return out;
}

class MissingFieldError extends Error {
  constructor(fieldPath, sourcePath) {
    super(
      `Required field "${fieldPath}" (from canonical path "${sourcePath}") is missing or null. ` +
      `Set on_missing to "null" or "omit" to handle this gracefully.`
    );
    this.name      = 'MissingFieldError';
    this.fieldPath = fieldPath;
  }
}

module.exports = { project, MissingFieldError };
