'use strict';

/**
 * Storage layer for Outwiles LocalPaste.
 *
 * Pastes are persisted as individual JSON files under DATA_DIR/pastes, plus
 * a lightweight index file (DATA_DIR/index.json) used for fast history
 * listing. There is no database and no network dependency — everything
 * lives on disk next to the application (or wherever DATA_DIR points).
 *
 * This module is deliberately defensive: a corrupted index, a corrupted
 * individual paste file, or a missing directory should never crash the
 * server. Where recovery is possible (e.g. rebuilding the index from the
 * paste files that still exist on disk), it happens automatically.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const config = require('./config');

const DATA_DIR = config.DATA_DIR;
const PASTES_DIR = path.join(DATA_DIR, 'pastes');
const INDEX_FILE = path.join(DATA_DIR, 'index.json');

const ID_ALPHABET = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ID_LENGTH = 8;
const MAX_ID_GENERATION_ATTEMPTS = 10;

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(PASTES_DIR)) fs.mkdirSync(PASTES_DIR, { recursive: true });
  if (!fs.existsSync(INDEX_FILE)) {
    writeJsonAtomic(INDEX_FILE, {});
  }
}

/**
 * Write JSON to disk atomically: write to a temp file in the same
 * directory, then rename over the target. A rename within the same
 * filesystem is atomic, so readers never observe a half-written file.
 * If anything fails, the temp file is cleaned up and the error is
 * re-thrown so callers can decide how to respond (rather than silently
 * losing data).
 */
function writeJsonAtomic(filePath, data) {
  const tmp = filePath + '.tmp-' + process.pid + '-' + Date.now() + '-' + Math.random().toString(36).slice(2);
  try {
    fs.writeFileSync(tmp, JSON.stringify(data), 'utf8');
    fs.renameSync(tmp, filePath);
  } catch (err) {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (cleanupErr) { /* best effort */ }
    throw new Error(`Failed to write ${path.basename(filePath)}: ${err.message}`);
  }
}

function readJsonSafe(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return { ok: true, data: JSON.parse(raw) };
  } catch (err) {
    return { ok: false, error: err };
  }
}

function generateId() {
  let id = '';
  const bytes = crypto.randomBytes(ID_LENGTH);
  for (let i = 0; i < ID_LENGTH; i++) {
    id += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
  }
  return id;
}

function pastePath(id) {
  // id is validated by isValidId before this is ever called.
  return path.join(PASTES_DIR, id + '.json');
}

const ID_PATTERN = /^[A-Za-z0-9]{4,32}$/;

function isValidId(id) {
  return typeof id === 'string' && ID_PATTERN.test(id);
}

function isValidPasteShape(paste) {
  return (
    paste &&
    typeof paste === 'object' &&
    typeof paste.id === 'string' &&
    typeof paste.content === 'string' &&
    typeof paste.createdAt === 'number'
  );
}

const EXPIRATION_MS = {
  never: null,
  '10m': 10 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
  '1w': 7 * 24 * 60 * 60 * 1000,
  '1mo': 30 * 24 * 60 * 60 * 1000
};

function isExpired(paste) {
  if (!paste.expiresAt) return false;
  return Date.now() > paste.expiresAt;
}

function indexEntryFromPaste(paste) {
  return {
    id: paste.id,
    title: paste.title,
    language: paste.language,
    expiration: paste.expiration,
    expiresAt: paste.expiresAt,
    visibility: paste.visibility,
    createdAt: paste.createdAt,
    seq: paste.seq,
    size: paste.size
  };
}

// Monotonic, in-process tiebreaker for pastes created within the same
// millisecond (createdAt has only millisecond resolution). Only used for
// sort order — never persisted as anything users see.
let creationSequence = 0;
function nextSequence() {
  creationSequence += 1;
  return creationSequence;
}

/**
 * Rebuild the index by scanning every paste file on disk. Used both at
 * startup (if index.json is missing/corrupt) and defensively whenever a
 * read of the index fails. Paste files that are themselves unreadable or
 * malformed are skipped and logged, rather than aborting the rebuild.
 */
function rebuildIndexFromDisk() {
  const index = {};
  let files = [];
  try {
    files = fs.readdirSync(PASTES_DIR).filter((f) => f.endsWith('.json'));
  } catch (err) {
    console.warn('[storage] Could not read pastes directory during index rebuild:', err.message);
    return index;
  }

  for (const file of files) {
    const filePath = path.join(PASTES_DIR, file);
    const result = readJsonSafe(filePath);
    if (!result.ok || !isValidPasteShape(result.data)) {
      console.warn(`[storage] Skipping unreadable paste file during index rebuild: ${file}`);
      continue;
    }
    index[result.data.id] = indexEntryFromPaste(result.data);
  }

  try {
    writeJsonAtomic(INDEX_FILE, index);
    console.warn(`[storage] Rebuilt index.json from ${Object.keys(index).length} paste file(s) on disk.`);
  } catch (err) {
    console.warn('[storage] Rebuilt index in memory but could not persist it:', err.message);
  }

  return index;
}

function loadIndex() {
  const result = readJsonSafe(INDEX_FILE);
  if (result.ok && result.data && typeof result.data === 'object') {
    return result.data;
  }
  console.warn('[storage] index.json is missing or corrupted — rebuilding from paste files on disk.');
  return rebuildIndexFromDisk();
}

function saveIndex(index) {
  writeJsonAtomic(INDEX_FILE, index);
}

function createPaste({ title, content, language, expiration, visibility }) {
  ensureDirs();

  let id = generateId();
  let attempts = 0;
  while (fs.existsSync(pastePath(id))) {
    attempts++;
    if (attempts >= MAX_ID_GENERATION_ATTEMPTS) {
      throw new Error('Could not generate a unique paste ID. Please try again.');
    }
    id = generateId();
  }

  const now = Date.now();
  const ttl = Object.prototype.hasOwnProperty.call(EXPIRATION_MS, expiration)
    ? EXPIRATION_MS[expiration]
    : null;

  const paste = {
    id,
    title: title || 'Untitled paste',
    content,
    language: language || 'plaintext',
    expiration: ttl === null ? 'never' : expiration,
    expiresAt: ttl === null ? null : now + ttl,
    visibility: visibility === 'lan' ? 'lan' : 'local',
    createdAt: now,
    seq: nextSequence(),
    size: Buffer.byteLength(content, 'utf8')
  };

  writeJsonAtomic(pastePath(id), paste);

  const index = loadIndex();
  index[id] = indexEntryFromPaste(paste);
  saveIndex(index);

  return paste;
}

function getPaste(id) {
  if (!isValidId(id)) return { error: 'invalid_id' };
  const filePath = pastePath(id);
  if (!fs.existsSync(filePath)) return { error: 'not_found' };

  const result = readJsonSafe(filePath);
  if (!result.ok || !isValidPasteShape(result.data)) {
    console.warn(`[storage] Paste file for "${id}" is corrupted or unreadable.`);
    return { error: 'not_found' };
  }
  const paste = result.data;

  if (isExpired(paste)) return { error: 'expired', paste };

  return { paste };
}

function deletePaste(id) {
  if (!isValidId(id)) return false;
  const filePath = pastePath(id);
  if (!fs.existsSync(filePath)) return false;

  fs.unlinkSync(filePath);
  const index = loadIndex();
  delete index[id];
  saveIndex(index);
  return true;
}

function listPastes() {
  ensureDirs();
  const index = loadIndex();
  return Object.values(index)
    .map((entry) => ({ ...entry, expired: entry.expiresAt ? Date.now() > entry.expiresAt : false }))
    .sort((a, b) => (b.createdAt - a.createdAt) || ((b.seq || 0) - (a.seq || 0)));
}

function cleanupExpired() {
  const index = loadIndex();
  const now = Date.now();
  let removed = 0;
  for (const [id, entry] of Object.entries(index)) {
    if (entry.expiresAt && now > entry.expiresAt) {
      const filePath = pastePath(id);
      try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch (err) {
        console.warn(`[storage] Could not remove expired paste file "${id}":`, err.message);
      }
      delete index[id];
      removed++;
    }
  }
  if (removed > 0) {
    try {
      saveIndex(index);
    } catch (err) {
      console.warn('[storage] Could not persist index after expiration cleanup:', err.message);
    }
  }
  return removed;
}

module.exports = {
  DATA_DIR,
  PASTES_DIR,
  INDEX_FILE,
  ensureDirs,
  createPaste,
  getPaste,
  deletePaste,
  listPastes,
  cleanupExpired,
  rebuildIndexFromDisk,
  isValidId,
  EXPIRATION_MS
};
