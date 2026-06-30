'use strict';

const logger = require('../utils/logger');

/**
 * BaseLoader — abstract base for all source loaders.
 *
 * Subclasses must implement:
 *   static canHandle(source) → boolean   (does this loader support the given source?)
 *   async _load(source) → PartialProfile | PartialProfile[] | null
 *
 * PartialProfile shape:
 * {
 *   source:           string,
 *   loader:           string,     // loader class name
 *   priority:         number,     // 1 (ATS, highest) … 5 (notes, lowest)
 *   extractionMethod: string,     // e.g. 'json-parse', 'regex-heuristic', 'api-fetch'
 *   data: {
 *     full_name:        string|null,
 *     emails:           string[],
 *     phones:           string[],
 *     location:         { city, region, country }|null,
 *     links:            { linkedin, github, portfolio, other[] }|null,
 *     headline:         string|null,
 *     years_experience: number|null,
 *     skills:           string[],
 *     experience:       ExperienceItem[],
 *     education:        EducationItem[],
 *   }
 * }
 *
 * ExperienceItem: { company, title, start, end, ongoing, summary }
 * EducationItem:  { institution, degree, field, end_year }
 */
class BaseLoader {
  constructor(sourceName, priority) {
    if (new.target === BaseLoader) {
      throw new Error('BaseLoader is abstract — instantiate a subclass.');
    }
    this.sourceName = sourceName;
    this.priority   = priority;
    this.loaderName = this.constructor.name;
  }

  /**
   * Public, error-safe entry point.
   * @param {*} source
   * @returns {Promise<object|object[]|null>}
   */
  async load(source) {
    try {
      const partial = await this._load(source);
      if (!partial) return null;

      const annotate = p => ({
        ...p,
        source:           this.sourceName,
        loader:           this.loaderName,
        priority:         this.priority,
        extractionMethod: p.extractionMethod || 'unknown',
      });

      return Array.isArray(partial)
        ? partial.filter(Boolean).map(annotate)
        : annotate(partial);

    } catch (err) {
      logger.warn(`[${this.loaderName}] load failed — skipping source`, {
        source: String(source).slice(0, 120),
        error:  err.message,
      });
      return null;
    }
  }

  /**
   * Subclasses must implement this.
   */
  async _load(_source) {
    throw new Error(`_load() not implemented in ${this.constructor.name}`);
  }

  /**
   * Static method: return true if this loader can handle the given source descriptor.
   * Override in subclasses. Default: false.
   *
   * @param {{ type: string, value: * }} _descriptor
   * @returns {boolean}
   */
  static canHandle(_descriptor) {
    return false;
  }

  /** Build an empty partial data scaffold */
  _emptyData() {
    return {
      full_name:        null,
      emails:           [],
      phones:           [],
      location:         null,
      links:            null,
      headline:         null,
      years_experience: null,
      skills:           [],
      experience:       [],
      education:        [],
    };
  }
}

module.exports = BaseLoader;
