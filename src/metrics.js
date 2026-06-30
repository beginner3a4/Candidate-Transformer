'use strict';

/**
 * Metrics — collects runtime telemetry for one pipeline run.
 *
 * Usage:
 *   const m = new Metrics();
 *   m.startTimer('load');
 *   ...
 *   m.stopTimer('load');
 *   m.increment('sourcesProcessed');
 *   const report = m.report();
 */
class Metrics {
  constructor() {
    this._timers  = {};
    this._started = Date.now();

    this.sourcesProcessed    = 0;
    this.recordsExtracted    = 0;
    this.fieldsNormalized    = 0;
    this.inferredFields      = 0;
    this.mergeConflicts      = 0;
    this.validationErrors    = 0;
    this.warnings            = 0;
    this.stageTimings        = {};
    this.loaderOutcomes      = [];  // [{ loader, status: 'ok'|'skipped'|'failed', records }]
  }

  /**
   * Start a named timer. Call stopTimer() with the same name to record duration.
   * @param {string} name
   */
  startTimer(name) {
    this._timers[name] = Date.now();
  }

  /**
   * Stop a named timer and record the elapsed time in ms.
   * @param {string} name
   * @returns {number} elapsed ms
   */
  stopTimer(name) {
    const start = this._timers[name];
    if (!start) return 0;
    const elapsed = Date.now() - start;
    this.stageTimings[name] = elapsed;
    delete this._timers[name];
    return elapsed;
  }

  /**
   * Increment a numeric counter.
   * @param {string} key
   * @param {number} [by=1]
   */
  increment(key, by = 1) {
    if (typeof this[key] === 'number') {
      this[key] += by;
    }
  }

  /**
   * Record a loader outcome.
   * @param {string} loader
   * @param {'ok'|'skipped'|'failed'} status
   * @param {number} [records=0]
   */
  recordLoader(loader, status, records = 0) {
    this.loaderOutcomes.push({ loader, status, records });
    if (status === 'ok') {
      this.sourcesProcessed += 1;
      this.recordsExtracted += records;
    }
  }

  /**
   * Produce a plain-object report.
   * @returns {object}
   */
  report() {
    const totalMs = Date.now() - this._started;
    return {
      total_duration_ms:    totalMs,
      sources_processed:    this.sourcesProcessed,
      records_extracted:    this.recordsExtracted,
      fields_normalized:    this.fieldsNormalized,
      inferred_fields:      this.inferredFields,
      merge_conflicts:      this.mergeConflicts,
      validation_errors:    this.validationErrors,
      warnings:             this.warnings,
      stage_timings_ms:     { ...this.stageTimings },
      loader_outcomes:      this.loaderOutcomes,
    };
  }

  /**
   * Produce a human-readable summary string for verbose mode.
   * @returns {string}
   */
  summary() {
    const r = this.report();
    const timings = Object.entries(r.stage_timings_ms)
      .map(([k, v]) => `  ${k.padEnd(18)} ${v}ms`)
      .join('\n');

    const loaders = r.loader_outcomes
      .map(l => `  ${l.loader.padEnd(10)} ${l.status.padEnd(8)} ${l.records} record(s)`)
      .join('\n');

    return [
      '── Metrics ─────────────────────────────────────',
      `  Total time:         ${r.total_duration_ms}ms`,
      `  Sources processed:  ${r.sources_processed}`,
      `  Records extracted:  ${r.records_extracted}`,
      `  Fields normalized:  ${r.fields_normalized}`,
      `  Inferred fields:    ${r.inferred_fields}`,
      `  Merge conflicts:    ${r.merge_conflicts}`,
      `  Validation errors:  ${r.validation_errors}`,
      `  Warnings:           ${r.warnings}`,
      '',
      '── Stage timings ───────────────────────────────',
      timings || '  (none)',
      '',
      '── Loader outcomes ─────────────────────────────',
      loaders || '  (none)',
      '────────────────────────────────────────────────',
    ].join('\n');
  }
}

module.exports = Metrics;
