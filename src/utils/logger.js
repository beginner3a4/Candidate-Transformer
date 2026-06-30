'use strict';

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

function getLevel() {
  return LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;
}

function fmt(level, msg, data) {
  const ts   = new Date().toISOString();
  const base = `[${ts}] [${level.toUpperCase().padEnd(5)}] ${msg}`;
  return data && Object.keys(data).length > 0
    ? `${base} ${JSON.stringify(data)}`
    : base;
}

const logger = {
  error(msg, data = {}) { if (getLevel() >= LEVELS.error) console.error(fmt('error', msg, data)); },
  warn(msg,  data = {}) { if (getLevel() >= LEVELS.warn)  console.warn(fmt('warn',  msg, data)); },
  info(msg,  data = {}) { if (getLevel() >= LEVELS.info)  console.log(fmt('info',   msg, data)); },
  debug(msg, data = {}) { if (getLevel() >= LEVELS.debug) console.log(fmt('debug',  msg, data)); },
};

module.exports = logger;
