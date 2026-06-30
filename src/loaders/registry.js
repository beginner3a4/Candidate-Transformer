'use strict';

const logger = require('../utils/logger');

/**
 * LoaderRegistry — a self-contained registry for source loaders.
 *
 * Design:
 *  - Loaders are registered with a string key (e.g. 'ats', 'csv').
 *  - The pipeline asks the registry to resolve a set of source descriptors;
 *    the registry selects the appropriate loader for each and invokes it.
 *  - Adding a new loader never requires modifying the pipeline.
 *
 * Usage:
 *   const registry = new LoaderRegistry();
 *   registry.register('ats',  AtsLoader);
 *   registry.register('csv',  CsvLoader);
 *   const partials = await registry.loadAll({ ats: '/data/ats.json', csv: '/data/rec.csv' });
 */
class LoaderRegistry {
  constructor() {
    /** @type {Map<string, Function>} key → loader class */
    this._loaders = new Map();
  }

  /**
   * Register a loader class under a key.
   *
   * @param {string}   key         - identifier (e.g. 'ats', 'csv')
   * @param {Function} LoaderClass - class that extends BaseLoader
   */
  register(key, LoaderClass) {
    if (typeof key !== 'string' || !key) throw new Error('LoaderRegistry: key must be a non-empty string');
    if (typeof LoaderClass !== 'function') throw new Error(`LoaderRegistry: ${key} must be a class`);
    this._loaders.set(key, LoaderClass);
    logger.debug(`[LoaderRegistry] registered loader "${key}" → ${LoaderClass.name}`);
  }

  /**
   * Return the list of registered loader keys.
   * @returns {string[]}
   */
  keys() {
    return [...this._loaders.keys()];
  }

  /**
   * Load all provided sources concurrently.
   * Sources whose key is not registered are warned and skipped.
   * Loader errors are caught; failing sources return null (never crash the pipeline).
   *
   * @param {object} sources  - { [key: string]: value }
   * @param {object} opts
   * @param {object} [opts.metrics]  - Metrics instance (optional)
   * @returns {Promise<{ partials: object[], outcomes: object[] }>}
   *   partials  — flat array of PartialProfile objects
   *   outcomes  — per-loader { key, status, records, error? }
   */
  async loadAll(sources = {}, opts = {}) {
    const { metrics } = opts;
    const entries = Object.entries(sources).filter(([, v]) => v !== null && v !== undefined && v !== false);

    const tasks = entries.map(async ([key, value]) => {
      const LoaderClass = this._loaders.get(key);

      if (!LoaderClass) {
        logger.warn(`[LoaderRegistry] No loader registered for key "${key}" — skipping`);
        if (metrics) metrics.recordLoader(key, 'skipped', 0);
        return { key, status: 'skipped', partials: [] };
      }

      try {
        const loader  = new LoaderClass();
        const result  = await loader.load(value);
        const list    = result ? (Array.isArray(result) ? result : [result]).filter(Boolean) : [];

        if (metrics) metrics.recordLoader(key, 'ok', list.length);
        logger.debug(`[LoaderRegistry] "${key}" → ${list.length} partial(s)`);
        return { key, status: 'ok', partials: list };

      } catch (err) {
        logger.warn(`[LoaderRegistry] "${key}" loader threw unexpectedly`, { error: err.message });
        if (metrics) metrics.recordLoader(key, 'failed', 0);
        return { key, status: 'failed', error: err.message, partials: [] };
      }
    });

    const results  = await Promise.all(tasks);
    const partials = results.flatMap(r => r.partials).filter(p => p && p.data);
    const outcomes = results.map(({ key, status, error }) => ({ key, status, error }));

    return { partials, outcomes };
  }
}

module.exports = LoaderRegistry;
