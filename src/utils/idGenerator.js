'use strict';

const crypto = require('crypto');

/**
 * Generate a deterministic 16-hex-char candidate ID.
 * Priority: first normalized email → normalized name → fallback random.
 */
function generateCandidateId(emails, name) {
  let seed = '';

  if (Array.isArray(emails) && emails.length > 0) {
    seed = emails[0].toLowerCase().trim();
  } else if (name && name.trim()) {
    seed = name.toLowerCase().trim().replace(/\s+/g, '_');
  }

  if (!seed) {
    return crypto.randomBytes(8).toString('hex');
  }

  return crypto.createHash('sha256').update(seed).digest('hex').slice(0, 16);
}

module.exports = { generateCandidateId };
