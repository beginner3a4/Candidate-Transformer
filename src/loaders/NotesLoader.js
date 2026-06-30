'use strict';

const fs         = require('fs');
const path       = require('path');
const BaseLoader = require('./BaseLoader');
const logger     = require('../utils/logger');

/**
 * NotesLoader — ingests free-text recruiter notes (.txt).
 *
 * Lowest priority source — confidence is intentionally reduced.
 * Extracts with heuristic patterns.
 */
class NotesLoader extends BaseLoader {
  constructor() {
    super('notes', 5);
  }

  static canHandle(descriptor) {
    return descriptor && descriptor.type === 'notes';
  }

  async _load(filePath) {
    if (!filePath) return null;

    const resolved = path.resolve(String(filePath));
    if (!fs.existsSync(resolved)) {
      logger.warn('[NotesLoader] File not found', { path: resolved });
      return null;
    }

    const text = fs.readFileSync(resolved, 'utf-8');
    if (!text.trim()) return null;

    return this._parseText(text);
  }

  _parseText(text) {
    const data = this._emptyData();

    // ── Email ─────────────────────────────────────────────────────────────
    const emailRe = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
    data.emails   = [...new Set(text.match(emailRe) || [])];

    // ── Phone ─────────────────────────────────────────────────────────────
    const phoneRe = /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
    data.phones   = [...new Set(text.match(phoneRe) || [])];

    // ── Name: contextual patterns ──────────────────────────────────────────
    const namePatterns = [
      /(?:spoke\s+with|spoke\s+to|met\s+with|talked\s+to|with)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/i,
      /^([A-Z][a-z]+\s+[A-Z][a-z]+)(?:\s+is\s+|\s+-\s+|\s*,\s*)/m,
      /candidate[:\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/i,
    ];
    for (const re of namePatterns) {
      const m = text.match(re);
      if (m) { data.full_name = m[1].trim(); break; }
    }

    // ── Links ─────────────────────────────────────────────────────────────
    const githubMatch   = text.match(/https?:\/\/(?:www\.)?github\.com\/[\w\-]+/i);
    const linkedinMatch = text.match(/https?:\/\/(?:www\.)?linkedin\.com\/in\/[\w\-]+/i);
    const portfolioRe   = /https?:\/\/(?!github|linkedin)[\w\-]+\.[\w\-]+(?:\.[\w\-]+)*(?:\/[\w\-./?=&#]*)?/gi;
    const portfolioMatches = (text.match(portfolioRe) || [])
      .filter(u => !u.match(/github|linkedin/i));

    data.links = {
      github:    githubMatch   ? githubMatch[0]   : null,
      linkedin:  linkedinMatch ? linkedinMatch[0] : null,
      portfolio: portfolioMatches[0] || null,
      other:     portfolioMatches.slice(1),
    };

    // ── Location ───────────────────────────────────────────────────────────
    const locMatch = text.match(
      /(?:located?\s+in|based\s+in|location[:\s]+)\s*([A-Za-z\s]+?)(?:\s+area|\s+Bay Area|[,\.\n])/i
    );
    if (locMatch) {
      data.location = { city: locMatch[1].trim(), region: null, country: null };
    }

    // ── Years of experience ────────────────────────────────────────────────
    const yoeMatch = text.match(/(\d+)\+?\s+years?\s+(?:of\s+)?(?:exp(?:erience)?|expertise)/i);
    if (yoeMatch) {
      data.years_experience = parseInt(yoeMatch[1], 10);
    }

    // ── Skills: scan for known keywords ───────────────────────────────────
    data.skills = extractMentionedSkills(text);

    // ── Headline: current role mention ────────────────────────────────────
    const roleMatch = text.match(
      /(?:currently\s+(?:at|working\s+at|a)\s+|works?\s+as\s+(?:a\s+)?)([\w\s]+?)(?:\s+at\s+[\w\s]+)?(?:\.|,|\n)/i
    );
    if (roleMatch) {
      data.headline = roleMatch[1].trim();
    }

    return { data, extractionMethod: 'regex-heuristic' };
  }
}

const SKILL_KEYWORDS = [
  'javascript', 'typescript', 'python', 'java', 'golang', 'rust', 'ruby', 'php',
  'react', 'node.js', 'nodejs', 'angular', 'vue', 'next.js', 'express',
  'aws', 'gcp', 'azure', 'docker', 'kubernetes', 'terraform', 'ci/cd',
  'sql', 'postgresql', 'mongodb', 'redis', 'elasticsearch',
  'machine learning', 'deep learning', 'nlp', 'tensorflow', 'pytorch',
  'graphql', 'rest api', 'microservices', 'devops', 'linux', 'bash',
  'agile', 'scrum', 'git', 'github', 'figma',
];

function extractMentionedSkills(text) {
  const lower = text.toLowerCase();
  const found = [];
  for (const kw of SKILL_KEYWORDS) {
    const re = new RegExp(`(?<![a-z])${kw.replace('.', '\\.')}(?![a-z])`, 'i');
    if (re.test(lower)) found.push(kw);
  }
  return found;
}

module.exports = NotesLoader;
