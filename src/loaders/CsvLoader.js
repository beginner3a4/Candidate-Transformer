'use strict';

const fs         = require('fs');
const path       = require('path');
const { parse }  = require('csv-parse/sync');
const BaseLoader = require('./BaseLoader');
const logger     = require('../utils/logger');

/**
 * CsvLoader — ingests a Recruiter CSV export.
 *
 * Column aliases (case-insensitive, space→underscore):
 *   name / full_name                    → full_name
 *   email / email_address               → emails
 *   phone / phone_number / mobile       → phones
 *   current_company / company / employer→ experience[0].company
 *   title / current_title / job_title   → headline / experience[0].title
 *   location / city                     → location.city
 *   state / region                      → location.region
 *   country                             → location.country
 *   linkedin / linkedin_url             → links.linkedin
 *   github / github_url                 → links.github
 *   portfolio / website                 → links.portfolio
 *   skills                              → skills (comma-separated)
 *   years_experience / yoe / experience_years → years_experience
 *
 * Handles: BOM, empty rows, extra columns, missing columns, duplicate records.
 */
class CsvLoader extends BaseLoader {
  constructor() {
    super('csv', 2);
  }

  static canHandle(descriptor) {
    return descriptor && descriptor.type === 'csv';
  }

  async _load(filePath) {
    if (!filePath) return null;

    let raw;
    try {
      const resolved = path.resolve(String(filePath));
      if (!fs.existsSync(resolved)) {
        logger.warn('[CsvLoader] File not found', { path: resolved });
        return null;
      }
      raw = fs.readFileSync(resolved, 'utf-8').replace(/^\uFEFF/, '');
    } catch (err) {
      logger.warn('[CsvLoader] Could not read file', { error: err.message });
      return null;
    }

    return this._parseBuffer(raw);
  }

  _parseBuffer(raw) {
    if (!raw || !raw.trim()) return null;

    let rows;
    try {
      rows = parse(raw, {
        columns:            true,
        skip_empty_lines:   true,
        trim:               true,
        relax_column_count: true,
      });
    } catch (err) {
      logger.warn('[CsvLoader] CSV parse error', { error: err.message });
      return null;
    }

    if (!rows || rows.length === 0) return null;

    // Normalize all column names to lowercase_with_underscores
    const normalized = rows.map(row => {
      const n = {};
      for (const [k, v] of Object.entries(row)) {
        n[k.toLowerCase().replace(/[\s\-]+/g, '_').replace(/[^a-z0-9_]/g, '').trim()] = v;
      }
      return n;
    });

    // Merge duplicate rows for the same person (keyed by email, then name)
    const byKey = new Map();
    for (const row of normalized) {
      const email = cell(row, 'email', 'email_address');
      const name  = cell(row, 'name', 'full_name', 'candidate_name');
      const key   = (email || '').toLowerCase().trim() || (name || '').toLowerCase().trim();
      if (!key) continue;

      if (!byKey.has(key)) {
        byKey.set(key, { ...row });
      } else {
        const existing = byKey.get(key);
        for (const field of Object.keys(row)) {
          const newVal = row[field];
          const oldVal = existing[field];
          if (newVal && (!oldVal || String(newVal).length > String(oldVal).length)) {
            existing[field] = newVal;
          }
        }
      }
    }

    const records = [...byKey.values()];
    if (records.length === 0) return null;
    if (records.length === 1) return this._rowToPartial(records[0]);
    return records.map(r => this._rowToPartial(r)).filter(Boolean);
  }

  _rowToPartial(row) {
    const data = this._emptyData();

    data.full_name = str(cell(row, 'name', 'full_name', 'candidate_name'));

    const emailVal = cell(row, 'email', 'email_address');
    if (emailVal) data.emails = [emailVal.trim()];

    const phoneVal = cell(row, 'phone', 'phone_number', 'mobile', 'cell');
    if (phoneVal) data.phones = [phoneVal.trim()];

    const title   = str(cell(row, 'title', 'current_title', 'job_title', 'position'));
    const company = str(cell(row, 'current_company', 'company', 'employer', 'organization'));
    if (title) data.headline = company ? `${title} at ${company}` : title;

    // Skeleton experience entry for current role
    if (title || company) {
      data.experience.push({
        company: company || null,
        title:   title   || null,
        start:   null,
        end:     null,
        ongoing: true,
        summary: null,
      });
    }

    // Location
    const locStr   = str(cell(row, 'location', 'city', 'city_state'));
    const regionStr = str(cell(row, 'state', 'region', 'province'));
    const countryStr = str(cell(row, 'country'));
    if (locStr || regionStr || countryStr) {
      data.location = { city: locStr, region: regionStr, country: countryStr };
    }

    // Links
    const linkedin  = str(cell(row, 'linkedin', 'linkedin_url', 'linkedin_profile'));
    const github    = str(cell(row, 'github', 'github_url', 'github_profile'));
    const portfolio = str(cell(row, 'portfolio', 'website', 'portfolio_url'));
    if (linkedin || github || portfolio) {
      data.links = { linkedin, github, portfolio, other: [] };
    }

    // Skills
    const skillsRaw = cell(row, 'skills', 'skill_set', 'tech_stack');
    if (skillsRaw) {
      data.skills = skillsRaw.split(/[,;|]+/).map(s => s.trim()).filter(Boolean);
    }

    // Years of experience
    const yoeRaw = cell(row, 'years_experience', 'yoe', 'experience_years', 'years_exp');
    if (yoeRaw) {
      const parsed = Number(yoeRaw);
      if (!isNaN(parsed) && parsed >= 0) data.years_experience = parsed;
    }

    return { data, extractionMethod: 'csv-parse' };
  }
}

/** Look up the first matching key from a row object. */
function cell(row, ...keys) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== '') return row[key];
  }
  return null;
}

function str(v) { return (v !== null && v !== undefined && String(v).trim()) || null; }

module.exports = CsvLoader;
