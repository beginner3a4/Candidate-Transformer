'use strict';

/**
 * Resolves dotted path expressions against a plain object.
 *
 * Supported syntax:
 *   'full_name'        → obj.full_name
 *   'emails[0]'        → obj.emails[0]
 *   'skills[].name'    → obj.skills.map(x => x.name)
 *   'links.github'     → obj.links.github
 *   'confidence.score' → obj.confidence.score
 */
function resolvePath(obj, pathExpr) {
  if (!pathExpr) return undefined;
  if (obj === null || obj === undefined) return undefined;

  const segments = tokenize(pathExpr);
  return evaluate(obj, segments);
}

function tokenize(expr) {
  const parts = expr.split('.');
  return parts.map(part => {
    const m = part.match(/^([^\[]+)(\[(\d*)\])?$/);
    if (!m) return { key: part };
    const key = m[1];
    if (!m[2]) return { key };
    if (m[3] === '') return { key, op: 'map' };
    return { key, op: 'index', index: parseInt(m[3], 10) };
  });
}

function evaluate(current, segments) {
  if (!segments.length) return current;
  if (current === null || current === undefined) return undefined;

  const [seg, ...rest] = segments;
  let value = typeof current === 'object' ? current[seg.key] : undefined;

  if (seg.op === 'index') {
    if (!Array.isArray(value)) return undefined;
    return evaluate(value[seg.index], rest);
  }

  if (seg.op === 'map') {
    if (!Array.isArray(value)) return undefined;
    return value
      .map(item => evaluate(item, rest))
      .filter(v => v !== undefined && v !== null);
  }

  return evaluate(value, rest);
}

module.exports = { resolvePath };
