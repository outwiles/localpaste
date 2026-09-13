'use strict';

/**
 * Spawns a LocalPaste server as a child process with an isolated data
 * directory and a random high port, so test files never collide with each
 * other or with a real running instance. Each test file should call
 * startServer() once (e.g. in a `before` hook) and stopServer() when done.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SERVER_ENTRY = path.join(__dirname, '..', 'server', 'server.js');

function randomPort() {
  return 20000 + Math.floor(Math.random() * 20000);
}

function makeTempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'outwiles-test-'));
}

async function waitForHealth(baseUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(baseUrl + '/api/health');
      if (res.ok) return true;
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Server did not become healthy in time: ' + (lastError ? lastError.message : 'unknown'));
}

/**
 * Starts a server instance. Returns { baseUrl, dataDir, stop, child }.
 * Extra environment variables (e.g. MAX_PASTE_SIZE) can be passed via env.
 */
async function startServer(env) {
  const port = randomPort();
  const dataDir = makeTempDataDir();

  const child = spawn(process.execPath, [SERVER_ENTRY], {
    env: Object.assign({}, process.env, {
      PORT: String(port),
      HOST: '127.0.0.1',
      DATA_DIR: dataDir
    }, env || {}),
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stderrOutput = '';
  child.stderr.on('data', (chunk) => { stderrOutput += chunk.toString(); });

  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await waitForHealth(baseUrl, 5000);
  } catch (err) {
    child.kill();
    throw new Error(`${err.message}\nServer stderr:\n${stderrOutput}`);
  }

  function stop() {
    return new Promise((resolve) => {
      child.once('exit', () => resolve());
      child.kill('SIGTERM');
      // Failsafe in case the process ignores SIGTERM.
      setTimeout(() => {
        try { child.kill('SIGKILL'); } catch (e) { /* already gone */ }
      }, 2000).unref();
    });
  }

  return { baseUrl, dataDir, stop, child };
}

module.exports = { startServer, makeTempDataDir };
