'use strict';

const Ajv        = require('ajv');
const addFormats = require('ajv-formats');
const schema     = require('./schemas/canonicalSchema.json');
const logger     = require('./utils/logger');

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

const validateCanonical = ajv.compile(schema);

/**
 * Validate a canonical profile against the canonical JSON Schema.
 *
 * Returns a structured validation report:
 * {
 *   valid:    boolean,
 *   errors:   ValidationError[],
 *   warnings: string[],
 * }
 *
 * ValidationError: { field: string, message: string, value?: * }
 *
 * @param {object} profile
 * @param {string} [context='canonical']
 * @param {object} [opts]
 * @param {boolean} [opts.strict=false]  - throw on failure instead of returning report
 * @returns {{ valid: boolean, errors: object[], warnings: string[] }}
 */
function validate(profile, context = 'canonical', opts = {}) {
  if (!profile || typeof profile !== 'object') {
    const err = { field: '/', message: 'Profile is null or not an object', value: profile };
    return { valid: false, errors: [err], warnings: [] };
  }

  const valid    = validateCanonical(profile);
  const warnings = [];

  if (!valid) {
    const errors = (validateCanonical.errors || []).map(e => {
      const field   = e.instancePath || e.dataPath || '/';
      const message = e.message || 'unknown error';
      return {
        field,
        message: `${field}: ${message}`,
        schemaPath: e.schemaPath,
        params:     e.params,
      };
    });

    logger.warn(`[Validator] ${context} schema validation failed`, {
      errorCount: errors.length,
      errors: errors.map(e => e.message),
    });

    if (opts.strict) {
      const messages = errors.map(e => e.message).join('; ');
      throw new ValidationError(`Strict validation failed for "${context}": ${messages}`, errors);
    }

    return { valid: false, errors, warnings };
  }

  // ── Soft warnings (valid schema but suspicious data) ─────────────────────
  if (profile.emails && profile.emails.length === 0) {
    warnings.push('No email addresses found — candidate matching may be unreliable');
  }
  if (profile.phones && profile.phones.length === 0) {
    warnings.push('No phone numbers found');
  }
  if (!profile.full_name) {
    warnings.push('full_name is null — name-based matching unavailable');
  }
  if (profile.confidence && profile.confidence.score < 0.4) {
    warnings.push(`Low overall confidence (${profile.confidence.score}) — review source data quality`);
  }
  if (profile.experience && profile.experience.length > 0) {
    const nullCompanies = profile.experience.filter(e => !e.company).length;
    if (nullCompanies > 0) {
      warnings.push(`${nullCompanies} experience entry(ies) have null company name`);
    }
  }

  if (warnings.length > 0) {
    logger.debug(`[Validator] ${context} has ${warnings.length} soft warning(s)`, { warnings });
  }

  return { valid: true, errors: [], warnings };
}

/**
 * Validate a projected (custom-config) output.
 * Best-effort: checks required fields and types.
 *
 * @param {object}   projected
 * @param {object[]} fieldDefs
 * @param {string}   onMissing
 * @returns {{ valid: boolean, errors: object[], warnings: string[] }}
 */
function validateProjected(projected, fieldDefs, onMissing) {
  const errors   = [];
  const warnings = [];

  for (const def of (fieldDefs || [])) {
    const fieldName = def.path;
    const required  = def.required === true;

    if (!(fieldName in projected)) {
      if (required && onMissing === 'error') {
        errors.push({
          field:   fieldName,
          message: `Required field "${fieldName}" is missing from projected output`,
        });
      } else if (required) {
        warnings.push(`Required field "${fieldName}" is null/missing (on_missing=${onMissing})`);
      }
      continue;
    }

    const value = projected[fieldName];

    if (required && (value === null || value === undefined)) {
      errors.push({
        field:   fieldName,
        message: `Required field "${fieldName}" is null`,
      });
    }

    if (def.type && value !== null && value !== undefined) {
      const expectedType = def.type.replace('[]', '');
      const isArray      = def.type.endsWith('[]');

      if (isArray && !Array.isArray(value)) {
        errors.push({ field: fieldName, message: `Field "${fieldName}" should be an array` });
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

class ValidationError extends Error {
  constructor(message, errors = []) {
    super(message);
    this.name   = 'ValidationError';
    this.errors = errors;
  }
}

module.exports = { validate, validateProjected, ValidationError };
