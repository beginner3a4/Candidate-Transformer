'use strict';

const fs         = require('fs');
const path       = require('path');
const BaseLoader = require('./BaseLoader');
const logger     = require('../utils/logger');

/**
 * ResumeLoader — ingests PDF, DOCX, or plain-text resume files.
 *
 * Extraction strategy:
 *  1. Extract raw text from the file (PDF / DOCX / TXT)
 *  2. Apply heuristic regex patterns to extract structured fields
 *  3. Return a PartialProfile — confidence is intentionally lower than ATS/CSV
 *
 * Supported formats: .txt, .pdf, .docx
 */
class ResumeLoader extends BaseLoader {
  constructor() {
    super('resume', 3);
  }

  static canHandle(descriptor) {
    return descriptor && descriptor.type === 'resume';
  }

  async _load(filePath) {
    if (!filePath) return null;

    const resolved = path.resolve(String(filePath));
    if (!fs.existsSync(resolved)) {
      logger.warn('[ResumeLoader] File not found', { path: resolved });
      return null;
    }

    const ext  = path.extname(resolved).toLowerCase();
    let   text = '';
    let   extractionMethod = 'text-heuristic';

    if (ext === '.txt') {
      text = fs.readFileSync(resolved, 'utf-8');
    } else if (ext === '.pdf') {
      text = await extractPdf(resolved);
      extractionMethod = 'pdf-parse+heuristic';
    } else if (ext === '.docx') {
      text = await extractDocx(resolved);
      extractionMethod = 'mammoth+heuristic';
    } else {
      try { text = fs.readFileSync(resolved, 'utf-8'); } catch (_) {}
    }

    if (!text || !text.trim()) {
      logger.warn('[ResumeLoader] Empty content extracted', { path: resolved });
      return null;
    }

    const partial = this._parseText(text);
    partial.extractionMethod = extractionMethod;
    return partial;
  }

  _parseText(text) {
    const data  = this._emptyData();
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

    // ── Email ──────────────────────────────────────────────────────────────
    const emailRe = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
    data.emails   = [...new Set(text.match(emailRe) || [])];

    // ── Phone ──────────────────────────────────────────────────────────────
    const phoneRe = /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
    data.phones   = [...new Set(text.match(phoneRe) || [])];

    // ── Name: first few lines that look like a name ────────────────────────
    for (const line of lines.slice(0, 5)) {
      if (!line.includes('@') && !/^\d/.test(line) && /^[A-Z][a-z]+ [A-Z]/.test(line)) {
        data.full_name = line;
        break;
      }
    }

    // ── Links ──────────────────────────────────────────────────────────────
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

    // ── Location: city/state pattern ───────────────────────────────────────
    const locMatch = text.match(/([A-Z][a-zA-Z\s]+),\s*([A-Z]{2})\b/);
    if (locMatch) {
      data.location = {
        city:    locMatch[1].trim(),
        region:  locMatch[2].trim(),
        country: null, // inferred later by inference engine
      };
    }

    // ── Years of experience: "N+ years" pattern ────────────────────────────
    const yoeMatch = text.match(/(\d+)\+?\s+years?\s+(?:of\s+)?(?:experience|expertise)/i);
    if (yoeMatch) {
      data.years_experience = parseInt(yoeMatch[1], 10);
    }

    // ── Skills section ─────────────────────────────────────────────────────
    data.skills = extractSkillsSection(text);

    // ── Experience section ─────────────────────────────────────────────────
    data.experience = extractExperience(text);

    // ── Education section ──────────────────────────────────────────────────
    data.education = extractEducation(text);

    // ── Headline: summary line after SUMMARY/PROFILE heading ──────────────
    const summaryIdx = lines.findIndex(l => /^SUMMARY|^PROFILE|^OBJECTIVE/i.test(l));
    if (summaryIdx !== -1 && lines[summaryIdx + 1]) {
      data.headline = lines[summaryIdx + 1].slice(0, 200);
    }

    return { data };
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function extractSkillsSection(text) {
  const skillsMatch = text.match(/SKILLS[\s\S]{0,20}\n([\s\S]+?)(?=\n[A-Z]{3,}|\n\n[A-Z]|$)/i);
  if (!skillsMatch) return [];

  return skillsMatch[1]
    .split(/[,\n|•·]+/)
    .map(s => s.trim())
    .filter(s => s.length > 1 && s.length < 60 && !/^\d+$/.test(s));
}

function extractExperience(text) {
  const expMatch = text.match(
    /(?:WORK\s+)?EXPERIENCE[\s\S]{0,10}\n([\s\S]+?)(?=\n(?:EDUCATION|CERTIFICATIONS|SKILLS|PROJECTS|$))/i
  );
  if (!expMatch) return [];

  const block   = expMatch[1];
  const entries = block.split(/\n(?=[A-Z][a-zA-Z\s]+\s*\|\s*)/);
  const results = [];

  for (const entry of entries) {
    if (!entry.trim()) continue;

    const headerMatch = entry.match(/^(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)(?:\n|$)/);
    if (!headerMatch) continue;

    const title   = headerMatch[1].trim();
    const company = headerMatch[2].trim();
    const dateStr = headerMatch[3].trim();

    let start = null, end = null, ongoing = false;
    const dateParts = dateStr.split(/\s*[-–]\s*/);
    if (dateParts.length >= 2) {
      start   = dateParts[0].trim();
      const endRaw = dateParts[1].trim();
      ongoing = /^present|current|now$/i.test(endRaw);
      end     = ongoing ? null : endRaw;
    } else {
      start = dateStr;
    }

    const restLines = entry.split('\n').slice(1).map(l => l.trim()).filter(Boolean);
    const summary   = restLines.join(' ').slice(0, 500) || null;

    if (title || company) {
      results.push({ company, title, start, end, ongoing, summary });
    }
  }

  return results;
}

function extractEducation(text) {
  const eduMatch = text.match(
    /EDUCATION[\s\S]{0,10}\n([\s\S]+?)(?=\nCERTIFIC|\nSKILLS|\nEXPERIENCE|\nPROJECTS|$)/i
  );
  if (!eduMatch) return [];

  const lines = eduMatch[1].split('\n').map(l => l.trim()).filter(Boolean);
  const results = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^(B\.|M\.|Ph|Grad|Relevant|Major|Minor|\d{4})/i.test(line)) continue;
    if (line.length < 4) continue;

    const institution = line;
    let degree = null, field = null, end_year = null;

    const next = lines[i + 1] || '';
    const degMatch = next.match(/^(B\.S\.|M\.S\.|Ph\.D\.|B\.A\.|M\.A\.|M\.Eng\.|B\.Eng\.)\s+(.+?)(?:\s*\|\s*(?:Graduated?\s+)?(\d{4}))?$/i);
    if (degMatch) {
      degree   = degMatch[1].trim();
      field    = degMatch[2].trim();
      end_year = degMatch[3] ? parseInt(degMatch[3], 10) : null;
      i++;
    }

    const yearMatch = next.match(/\b(20\d{2}|19\d{2})\b/);
    if (!end_year && yearMatch) end_year = parseInt(yearMatch[1], 10);

    results.push({ institution, degree, field, end_year });
  }

  return results;
}

async function extractPdf(filePath) {
  try {
    const pdfParse = require('pdf-parse');
    const buffer   = fs.readFileSync(filePath);
    const result   = await pdfParse(buffer);
    return result.text || '';
  } catch (err) {
    logger.warn('[ResumeLoader] PDF extraction failed', { error: err.message });
    return '';
  }
}

async function extractDocx(filePath) {
  try {
    const mammoth = require('mammoth');
    const result  = await mammoth.extractRawText({ path: filePath });
    return result.value || '';
  } catch (err) {
    logger.warn('[ResumeLoader] DOCX extraction failed', { error: err.message });
    return '';
  }
}

module.exports = ResumeLoader;
