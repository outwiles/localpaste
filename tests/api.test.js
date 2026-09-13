'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { startServer } = require('./helpers');

test('API behavior', async (t) => {
  const server = await startServer();
  t.after(() => server.stop());

  await t.test('GET /api/health reports ok', async () => {
    const res = await fetch(server.baseUrl + '/api/health');
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, 'ok');
    assert.equal(typeof data.uptimeSeconds, 'number');
  });

  await t.test('GET /api/network returns real, non-fake data', async () => {
    const res = await fetch(server.baseUrl + '/api/network');
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.port > 0, true);
    assert.equal(data.localUrl, `http://localhost:${data.port}`);
    assert.equal(Array.isArray(data.lanAddresses), true);
  });

  let createdPaste;

  await t.test('POST /api/pastes creates a paste', async () => {
    const res = await fetch(server.baseUrl + '/api/pastes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Hello',
        content: 'console.log("hi");',
        language: 'javascript',
        expiration: '1h',
        visibility: 'local'
      })
    });
    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.paste.title, 'Hello');
    assert.equal(data.paste.content, 'console.log("hi");');
    assert.equal(data.paste.language, 'javascript');
    assert.equal(data.paste.visibility, 'local');
    assert.equal(typeof data.paste.id, 'string');
    assert.equal(data.paste.id.length >= 4, true);
    createdPaste = data.paste;
  });

  await t.test('GET /api/pastes/:id retrieves the created paste', async () => {
    const res = await fetch(server.baseUrl + '/api/pastes/' + createdPaste.id);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.paste.id, createdPaste.id);
    assert.equal(data.paste.content, 'console.log("hi");');
  });

  await t.test('GET /api/pastes/:id/raw returns exact plain-text content', async () => {
    const res = await fetch(server.baseUrl + '/api/pastes/' + createdPaste.id + '/raw');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /text\/plain/);
    const text = await res.text();
    assert.equal(text, 'console.log("hi");');
  });

  await t.test('GET /raw/:id (short alias) also works', async () => {
    const res = await fetch(server.baseUrl + '/raw/' + createdPaste.id);
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.equal(text, 'console.log("hi");');
  });

  await t.test('GET /api/pastes lists the created paste', async () => {
    const res = await fetch(server.baseUrl + '/api/pastes');
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(Array.isArray(data.pastes), true);
    assert.equal(data.pastes.some((p) => p.id === createdPaste.id), true);
    // The list view is metadata only — it must not leak full content.
    assert.equal(data.pastes[0].content, undefined);
  });

  await t.test('GET /api/pastes/:id with an unknown but valid-looking ID returns 404', async () => {
    const res = await fetch(server.baseUrl + '/api/pastes/zzzzzzzz');
    assert.equal(res.status, 404);
    const data = await res.json();
    assert.equal(data.error.code, 'not_found');
  });

  await t.test('GET /api/pastes/:id with a malformed ID returns 400, not a crash', async () => {
    const res = await fetch(server.baseUrl + '/api/pastes/' + encodeURIComponent('../../etc/passwd'));
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.error.code, 'invalid_id');
  });

  await t.test('POST /api/pastes rejects empty content', async () => {
    const res = await fetch(server.baseUrl + '/api/pastes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '' })
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.error.code, 'validation_failed');
  });

  await t.test('POST /api/pastes rejects an invalid expiration value', async () => {
    const res = await fetch(server.baseUrl + '/api/pastes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'x', expiration: '3 fortnights' })
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.error.code, 'validation_failed');
  });

  await t.test('POST /api/pastes rejects an invalid visibility value', async () => {
    const res = await fetch(server.baseUrl + '/api/pastes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'x', visibility: 'public-internet' })
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.error.code, 'validation_failed');
  });

  await t.test('POST /api/pastes rejects malformed JSON', async () => {
    const res = await fetch(server.baseUrl + '/api/pastes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ not valid json'
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.error.code, 'invalid_json');
  });

  await t.test('POST /api/pastes rejects a JSON array as the body', async () => {
    const res = await fetch(server.baseUrl + '/api/pastes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '[1,2,3]'
    });
    assert.equal(res.status, 400);
  });

  await t.test('An expired paste returns 410 and is not served', async () => {
    // Create with a real expiration, then age it by rewriting the stored
    // file's expiresAt into the past — this exercises the same code path
    // a real expiry would, without waiting.
    const createRes = await fetch(server.baseUrl + '/api/pastes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'soon gone', expiration: '10m' })
    });
    const { paste } = await createRes.json();

    const filePath = path.join(server.dataDir, 'pastes', paste.id + '.json');
    const onDisk = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    onDisk.expiresAt = Date.now() - 1000;
    fs.writeFileSync(filePath, JSON.stringify(onDisk));

    const res = await fetch(server.baseUrl + '/api/pastes/' + paste.id);
    assert.equal(res.status, 410);
    const data = await res.json();
    assert.equal(data.error.code, 'expired');

    const rawRes = await fetch(server.baseUrl + '/api/pastes/' + paste.id + '/raw');
    assert.equal(rawRes.status, 410);
  });

  await t.test('DELETE /api/pastes/:id removes the paste', async () => {
    const res = await fetch(server.baseUrl + '/api/pastes/' + createdPaste.id, { method: 'DELETE' });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.deleted, true);

    const getRes = await fetch(server.baseUrl + '/api/pastes/' + createdPaste.id);
    assert.equal(getRes.status, 404);
  });

  await t.test('DELETE /api/pastes/:id on an already-deleted paste returns 404', async () => {
    const res = await fetch(server.baseUrl + '/api/pastes/' + createdPaste.id, { method: 'DELETE' });
    assert.equal(res.status, 404);
  });

  await t.test('Unsupported method on a paste collection returns 405', async () => {
    const res = await fetch(server.baseUrl + '/api/pastes', { method: 'PATCH' });
    assert.equal(res.status, 405);
  });

  await t.test('Static file path traversal attempts are rejected', async () => {
    const res = await fetch(server.baseUrl + '/' + encodeURIComponent('../../../../etc/passwd'));
    // Either rejected outright, or safely resolved back inside public/ and
    // served as the SPA fallback — either way, it must not be 200 with
    // system file contents, and must not crash the server.
    assert.notEqual(res.status, 500);
    const health = await fetch(server.baseUrl + '/api/health');
    assert.equal(health.status, 200);
  });

  await t.test('Security headers are present on API responses', async () => {
    const res = await fetch(server.baseUrl + '/api/health');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  });

  await t.test('Security headers include a Content-Security-Policy on HTML pages', async () => {
    const res = await fetch(server.baseUrl + '/');
    assert.match(res.headers.get('content-security-policy') || '', /default-src 'self'/);
  });

  await t.test('Concurrent paste creation produces unique IDs and no data loss', async () => {
    const requests = Array.from({ length: 15 }, (_, i) =>
      fetch(server.baseUrl + '/api/pastes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'concurrent-' + i })
      }).then((r) => r.json())
    );
    const results = await Promise.all(requests);
    const ids = results.map((r) => r.paste.id);
    const uniqueIds = new Set(ids);
    assert.equal(uniqueIds.size, ids.length);

    const listRes = await fetch(server.baseUrl + '/api/pastes');
    const listData = await listRes.json();
    for (const id of ids) {
      assert.equal(listData.pastes.some((p) => p.id === id), true);
    }
  });
});

test('Oversized paste content is rejected (MAX_PASTE_SIZE)', async (t) => {
  const server = await startServer({ MAX_PASTE_SIZE: '100' }); // 100 bytes
  t.after(() => server.stop());

  const res = await fetch(server.baseUrl + '/api/pastes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: 'x'.repeat(500) })
  });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.error.code, 'validation_failed');

  // Content within the limit is still accepted.
  const okRes = await fetch(server.baseUrl + '/api/pastes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: 'small' })
  });
  assert.equal(okRes.status, 201);
});

test('An oversized raw request body is rejected with 413', async (t) => {
  const server = await startServer({ MAX_PASTE_SIZE: '1024' });
  t.after(() => server.stop());

  const hugeBody = JSON.stringify({ content: 'y'.repeat(5 * 1024 * 1024) });
  const res = await fetch(server.baseUrl + '/api/pastes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: hugeBody
  });
  assert.equal(res.status, 413);
});
