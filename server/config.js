'use strict';

/**
 * Centralized configuration for Outwiles LocalPaste.
 *
 * Every setting has a sensible default so `npm start` works out of the box.
 * All values are read once at startup from environment variables.
 */

const path = require('path');

function parseIntEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    console.warn(`[config] Ignoring invalid ${name}="${raw}" — using default ${fallback}`);
    return fallback;
  }
  return parsed;
}

const PORT = parseIntEnv('PORT', 8420);
const HOST = process.env.HOST || '0.0.0.0';

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', 'data');

// MAX_PASTE_SIZE is expressed in bytes. Default: 2 MB.
const MAX_PASTE_SIZE = parseIntEnv('MAX_PASTE_SIZE', 2 * 1024 * 1024);

// Hard ceiling on the raw request body (a little above MAX_PASTE_SIZE to
// leave room for JSON structure/escaping overhead around the content field).
const MAX_REQUEST_BYTES = MAX_PASTE_SIZE + 512 * 1024;

// How often the background sweep removes expired pastes from disk.
const CLEANUP_INTERVAL_MS = parseIntEnv('CLEANUP_INTERVAL_MS', 5 * 60 * 1000);

module.exports = {
  PORT,
  HOST,
  DATA_DIR,
  MAX_PASTE_SIZE,
  MAX_REQUEST_BYTES,
  CLEANUP_INTERVAL_MS
};
