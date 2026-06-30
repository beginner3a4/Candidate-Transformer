'use strict';

const axios      = require('axios');
const BaseLoader = require('./BaseLoader');
const logger     = require('../utils/logger');

const GH_API             = 'https://api.github.com';
const MAX_REPOS_TO_SCAN  = 20;
const MAX_LANGS_TO_REPORT = 8;

/**
 * GitHubLoader — fetches public GitHub profile data via the GitHub REST API.
 *
 * Accepts: GitHub profile URL (https://github.com/username) or plain username.
 * Requires: GITHUB_TOKEN env var for higher rate limits (optional but recommended).
 *
 * Extracts:
 *  - name, bio (headline), public email, location
 *  - links.github, links.portfolio (from profile blog field)
 *  - skills inferred from top programming languages across recent repos
 *  - years_experience approximation from account creation date (low weight)
 *
 * Gracefully handles: 404, 403 (rate limit), network errors → returns null.
 */
class GitHubLoader extends BaseLoader {
  constructor() {
    super('github', 4);
  }

  static canHandle(descriptor) {
    return descriptor && descriptor.type === 'github';
  }

  async _load(source) {
    if (!source) return null;

    const username = extractUsername(String(source));
    if (!username) {
      logger.warn('[GitHubLoader] Could not extract username from source', { source });
      return null;
    }

    let profile, repos;
    try {
      const headers = buildHeaders();

      const [profileRes, reposRes] = await Promise.all([
        axios.get(`${GH_API}/users/${username}`, { headers, timeout: 8000 }),
        axios.get(`${GH_API}/users/${username}/repos`, {
          headers, timeout: 8000,
          params: { sort: 'pushed', per_page: MAX_REPOS_TO_SCAN },
        }),
      ]);

      profile = profileRes.data;
      repos   = reposRes.data;

    } catch (err) {
      const status = err.response && err.response.status;
      if (status === 404)      logger.warn('[GitHubLoader] User not found', { username });
      else if (status === 403) logger.warn('[GitHubLoader] Rate limited by GitHub API', { username });
      else                     logger.warn('[GitHubLoader] API request failed', { username, error: err.message });
      return null;
    }

    return this._buildPartial(profile, repos || [], username);
  }

  _buildPartial(profile, repos, username) {
    const data = this._emptyData();

    data.full_name = str(profile.name);
    data.headline  = str(profile.bio);

    if (profile.email) data.emails = [profile.email];

    if (profile.location) {
      data.location = { city: profile.location, region: null, country: null };
    }

    data.links = {
      github:    `https://github.com/${username}`,
      linkedin:  null,
      portfolio: str(profile.blog) || null,
      other:     [],
    };

    // Account age as a weak proxy for experience — halved by merger to avoid inflation
    if (profile.created_at) {
      const created = new Date(profile.created_at);
      const years   = Math.floor((Date.now() - created.getTime()) / (1000 * 60 * 60 * 24 * 365));
      data.years_experience = Math.min(years, 30);
    }

    // Top languages from non-fork repos
    const langCounts = {};
    for (const repo of repos) {
      if (repo.language && !repo.fork) {
        langCounts[repo.language] = (langCounts[repo.language] || 0) + 1;
      }
    }
    data.skills = Object.entries(langCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_LANGS_TO_REPORT)
      .map(([lang]) => lang);

    return { data, extractionMethod: 'github-api' };
  }
}

function extractUsername(source) {
  const urlMatch = source.match(/github\.com\/([a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38})\/?/i);
  if (urlMatch) return urlMatch[1];
  if (/^[a-zA-Z0-9\-]+$/.test(source.trim())) return source.trim();
  return null;
}

function buildHeaders() {
  const headers = {
    'Accept':     'application/vnd.github.v3+json',
    'User-Agent': 'candidate-transformer/1.0',
  };
  if (process.env.GITHUB_TOKEN) {
    headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`;
  }
  return headers;
}

function str(v) { return (v && String(v).trim()) || null; }

module.exports = GitHubLoader;
