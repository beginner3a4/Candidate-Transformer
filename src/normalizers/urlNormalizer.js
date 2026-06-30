'use strict';

/**
 * Normalize a URL string.
 * - Ensures https:// prefix when missing
 * - Strips trailing slashes
 * - Lowercases hostname
 * Returns null for clearly invalid input.
 *
 * @param {string|null} raw
 * @returns {string|null}
 */
function normalizeUrl(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let trimmed = raw.trim();
  if (!trimmed) return null;

  // Add protocol if missing
  if (!/^https?:\/\//i.test(trimmed)) {
    trimmed = 'https://' + trimmed;
  }

  try {
    const url = new URL(trimmed);
    // Lowercase the hostname
    url.hostname = url.hostname.toLowerCase();
    // Remove trailing slash from pathname if it's just "/"
    let href = url.href;
    if (href.endsWith('/') && url.pathname === '/') {
      href = href.slice(0, -1);
    }
    return href;
  } catch (_) {
    return null;
  }
}

/**
 * Extract GitHub username from a GitHub profile URL or plain username string.
 * Returns null if not a recognizable GitHub reference.
 *
 * @param {string|null} raw
 * @returns {string|null}
 */
function extractGithubUsername(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();

  // Full URL: https://github.com/username or https://github.com/username/...
  const urlMatch = trimmed.match(/github\.com\/([a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38})\/?/i);
  if (urlMatch) return urlMatch[1];

  // Plain username (no slashes, no protocol, valid GitHub chars)
  if (/^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/.test(trimmed)) return trimmed;

  return null;
}

/**
 * Normalize a GitHub profile URL from a username or URL.
 *
 * @param {string|null} raw
 * @returns {string|null} canonical URL like https://github.com/username
 */
function normalizeGithubUrl(raw) {
  const username = extractGithubUsername(raw);
  return username ? `https://github.com/${username}` : null;
}

/**
 * Normalize a LinkedIn profile URL.
 * Strips query params and normalizes to https://linkedin.com/in/handle
 *
 * @param {string|null} raw
 * @returns {string|null}
 */
function normalizeLinkedinUrl(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();

  const match = trimmed.match(/linkedin\.com\/in\/([\w\-]+)/i);
  if (match) return `https://linkedin.com/in/${match[1]}`;

  return null;
}

module.exports = { normalizeUrl, extractGithubUsername, normalizeGithubUrl, normalizeLinkedinUrl };
