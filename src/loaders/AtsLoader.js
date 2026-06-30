'use strict';

const fs         = require('fs');
const path       = require('path');
const BaseLoader = require('./BaseLoader');
const logger     = require('../utils/logger');

/**
 * AtsLoader — ingests an ATS (Applicant Tracking System) JSON blob.
 *
 * Accepts:
 *  - File path (string)
 *  - Already-parsed object or array
 *
 * Field aliases supported:
 *   applicant_name / name / full_name  → full_name
 *   contact.email / email              → emails
 *   contact.phone / phone              → phones
 *   contact.alt_email / alt_email      → emails (secondary)
 *   contact.alt_phone / alt_phone      → phones (secondary)
 *   position / title                   → headline / experience[0].title
 *   company                            → experience[0].company
 *   work_history[] / experience[]      → experience[]
 *   education[]                        → education[]
 *   skills[]                           → skills[]
 *   years_experience / yoe             → years_experience
 *   linkedin_url / linkedin            → links.linkedin
 *   github_url / github                → links.github
 *   portfolio_url / portfolio          → links.portfolio
 */
class AtsLoader extends BaseLoader {
  constructor() {
    super('ats', 1);
  }

  static canHandle(descriptor) {
    return descriptor && descriptor.type === 'ats';
  }

  async _load(source) {
    let raw;

    if (typeof source === 'object' && source !== null) {
      raw = source;
    } else {
      const resolved = path.resolve(String(source));
      if (!fs.existsSync(resolved)) {
        logger.warn('[AtsLoader] File not found', { path: resolved });
        return null;
      }

      let text;
      try {
        text = fs.readFileSync(resolved, 'utf-8').trim();
      } catch (err) {
        logger.warn('[AtsLoader] Could not read file', { path: resolved, error: err.message });
        return null;
      }

      if (!text) return null;

      try {
        raw = JSON.parse(text);
      } catch (err) {
        logger.warn('[AtsLoader] JSON parse error — file is malformed', { path: resolved, error: err.message });
        return null;
      }
    }

    if (!raw || typeof raw !== 'object') return null;

    const applicants = Array.isArray(raw)
      ? raw
      : (raw.applicants || raw.candidates || raw.data || [raw]);

    if (!applicants || applicants.length === 0) return null;

    const partials = applicants
      .map(a => this._recordToPartial(a))
      .filter(Boolean);

    if (partials.length === 0) return null;
    if (partials.length === 1) return partials[0];
    return partials;
  }

  _recordToPartial(record) {
    if (!record || typeof record !== 'object') return null;

    const data = this._emptyData();

    data.full_name = str(record.applicant_name || record.name || record.full_name);

    // Emails
    const contact = record.contact || {};
    const emails  = [];
    if (contact.email)     emails.push(contact.email);
    if (contact.alt_email) emails.push(contact.alt_email);
    if (record.email)      emails.push(record.email);
    data.emails = [...new Set(emails.filter(Boolean))];

    // Phones
    const phones = [];
    if (contact.phone)     phones.push(contact.phone);
    if (contact.alt_phone) phones.push(contact.alt_phone);
    if (record.phone)      phones.push(record.phone);
    data.phones = [...new Set(phones.filter(Boolean))];

    // Location
    const loc = record.location || {};
    if (loc.city || loc.state || loc.region || loc.country) {
      data.location = {
        city:    str(loc.city),
        region:  str(loc.state || loc.region),
        country: str(loc.country),
      };
    }

    // Links
    const linkedin  = str(record.linkedin_url  || record.linkedin);
    const github    = str(record.github_url    || record.github);
    const portfolio = str(record.portfolio_url || record.portfolio);
    if (linkedin || github || portfolio) {
      data.links = { linkedin, github, portfolio, other: [] };
    }

    // Headline
    const position = str(record.position || record.title);
    const company  = str(record.company);
    if (position) {
      data.headline = company ? `${position} at ${company}` : position;
    }

    // Years of experience
    const yoe = record.years_experience ?? record.yoe ?? record.years_exp;
    if (yoe !== null && yoe !== undefined) {
      const parsed = Number(yoe);
      if (!isNaN(parsed) && parsed >= 0) data.years_experience = parsed;
    }

    // Skills
    data.skills = (record.skills || [])
      .map(s => String(s).trim())
      .filter(Boolean);

    // Experience
    data.experience = (record.work_history || record.experience || [])
      .map(w => {
        const endRaw = str(w.end_date || w.end);
        const isOngoing = endRaw === null || endRaw === undefined || /^(present|current|now)$/i.test(endRaw);
        return {
          company: str(w.company),
          title:   str(w.title || w.position),
          start:   str(w.start_date || w.start),
          end:     isOngoing ? null : endRaw,
          ongoing: isOngoing,
          summary: str(w.description || w.summary),
        };
      })
      .filter(e => e.company || e.title);

    // Education
    data.education = (record.education || [])
      .map(e => ({
        institution: str(e.school || e.institution),
        degree:      str(e.degree),
        field:       str(e.field_of_study || e.field),
        end_year:    num(e.graduation_year || e.end_year),
      }))
      .filter(e => e.institution);

    return { data, extractionMethod: 'json-parse' };
  }
}

function str(v) { return (v !== null && v !== undefined && String(v).trim()) || null; }
function num(v) { const n = Number(v); return (v !== null && v !== undefined && !isNaN(n)) ? n : null; }

module.exports = AtsLoader;
