'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * storage.js (and config.js) read DATA_DIR from the environment at require
 * time, so each test gets a fresh module instance pointed at its own temp
 * directory by clearing the require cache before requiring again.
 */
function freshStorage(dataDir) {
  const configPath = require.resolve('../server/config');
  const storagePath = require.resolve('../server/storage');
  delete require.cache[configPath];
  delete require.cache[storagePath];
  const previous = process.env.DATA_DIR;
  process.env.DATA_DIR = dataDir;
  const storage = require('../server/storage');
  process.env.DATA_DIR = previous;
  return storage;
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'outwiles-storage-test-'));
}

test('createPaste + getPaste round-trip', () => {
  const storage = freshStorage(tempDir());
  const paste = storage.createPaste({
    title: 'Test',
    content: 'hello world',
    language: 'plaintext',
    expiration: 'never',
    visibility: 'local'
  });
  const result = storage.getPaste(paste.id);
  assert.equal(result.paste.content, 'hello world');
  assert.equal(result.paste.title, 'Test');
});

test('getPaste rejects invalid and unknown IDs safely', () => {
  const storage = freshStorage(tempDir());
  assert.equal(storage.getPaste('../../etc/passwd').error, 'invalid_id');
  assert.equal(storage.getPaste('ab').error, 'invalid_id'); // shorter than the minimum length
  assert.equal(storage.getPaste('has spaces').error, 'invalid_id');
  assert.equal(storage.getPaste('nonexistent1').error, 'not_found'); // valid shape, doesn't exist
});

test('deletePaste removes the paste and updates the index', () => {
  const storage = freshStorage(tempDir());
  const paste = storage.createPaste({ content: 'to delete' });
  assert.equal(storage.deletePaste(paste.id), true);
  assert.equal(storage.getPaste(paste.id).error, 'not_found');
  assert.equal(storage.deletePaste(paste.id), false); // already gone
});

test('listPastes reflects created and deleted pastes, newest first', () => {
  const storage = freshStorage(tempDir());
  const first = storage.createPaste({ content: 'one' });
  const second = storage.createPaste({ content: 'two' });
  const list = storage.listPastes();
  assert.equal(list.length, 2);
  assert.equal(list[0].id, second.id); // newest first
  assert.equal(list[1].id, first.id);
});

test('cleanupExpired removes only expired pastes', () => {
  const dir = tempDir();
  const storage = freshStorage(dir);
  const keep = storage.createPaste({ content: 'keep me', expiration: 'never' });
  const expire = storage.createPaste({ content: 'expire me', expiration: '10m' });

  // Force it into the past. Both the paste file and its index entry carry
  // expiresAt in normal operation, so an accurate simulation of "time has
  // passed" updates both — cleanupExpired reads the index for speed.
  const filePath = path.join(dir, 'pastes', expire.id + '.json');
  const onDisk = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  onDisk.expiresAt = Date.now() - 1;
  fs.writeFileSync(filePath, JSON.stringify(onDisk));

  const indexPath = path.join(dir, 'index.json');
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  index[expire.id].expiresAt = Date.now() - 1;
  fs.writeFileSync(indexPath, JSON.stringify(index));

  const removed = storage.cleanupExpired();
  assert.equal(removed, 1);
  assert.equal(fs.existsSync(filePath), false);
  assert.equal(storage.getPaste(keep.id).paste.content, 'keep me');
});

test('a corrupted index.json is rebuilt from paste files on disk', () => {
  const dir = tempDir();
  const storage = freshStorage(dir);
  const paste = storage.createPaste({ content: 'survives index corruption' });

  fs.writeFileSync(path.join(dir, 'index.json'), '{ this is not valid json');

  const list = storage.listPastes();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, paste.id);

  // The rebuild should have persisted a valid index back to disk.
  const rebuilt = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
  assert.equal(Object.keys(rebuilt).length, 1);
});

test('a corrupted individual paste file is reported as not found, not a crash', () => {
  const dir = tempDir();
  const storage = freshStorage(dir);
  const paste = storage.createPaste({ content: 'will be corrupted' });

  fs.writeFileSync(path.join(dir, 'pastes', paste.id + '.json'), 'not { valid json');

  const result = storage.getPaste(paste.id);
  assert.equal(result.error, 'not_found');
});

test('missing data directories are recreated automatically', () => {
  const dir = tempDir();
  const storage = freshStorage(dir);
  storage.createPaste({ content: 'first' });

  fs.rmSync(path.join(dir, 'pastes'), { recursive: true, force: true });
  fs.rmSync(path.join(dir, 'index.json'), { force: true });

  // Should not throw, and should be able to create a new paste afterward.
  const paste = storage.createPaste({ content: 'after recreation' });
  assert.equal(storage.getPaste(paste.id).paste.content, 'after recreation');
});

test('atomic writes never leave temp files behind on success', () => {
  const dir = tempDir();
  const storage = freshStorage(dir);
  storage.createPaste({ content: 'clean write' });
  const files = fs.readdirSync(path.join(dir, 'pastes'));
  assert.equal(files.every((f) => !f.includes('.tmp-')), true);
  const dataFiles = fs.readdirSync(dir);
  assert.equal(dataFiles.every((f) => !f.includes('.tmp-')), true);
});

test('unrecognized expiration keys fall back safely rather than throwing', () => {
  const storage = freshStorage(tempDir());
  // The server layer validates this before calling storage, but storage
  // itself should never throw on an unexpected value.
  const paste = storage.createPaste({ content: 'x', expiration: 'not-a-real-value' });
  assert.equal(paste.expiration, 'never');
  assert.equal(paste.expiresAt, null);
});
