'use strict';

/**
 * Outwiles LocalPaste server.
 *
 * A dependency-free Node.js HTTP server that serves the frontend and a
 * small JSON API for creating, retrieving, and deleting pastes. Storage is
 * a flat set of JSON files on disk (see storage.js). No database, no
 * external network calls, no telemetry.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const url = require('url');

const config = require('./config');
const storage = require('./storage');

const PORT = config.PORT;
const HOST = config.HOST;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const MAX_CONTENT_BYTES = config.MAX_PASTE_SIZE;
const MAX_REQUEST_BYTES = config.MAX_REQUEST_BYTES;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

// Content Security Policy for HTML documents. Everything LocalPaste needs
// (scripts, styles, fonts) is served by this same origin — there are no
// CDNs or third-party origins involved, so the policy can be tight.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'"
].join('; ');

/**
 * Security headers applied to every response, API and static alike.
 * These are conservative, low-risk defaults appropriate for a same-origin,
 * no-third-party-embed application — not a replacement for authentication.
 */
function securityHeaders(isHtml) {
  const headers = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()'
  };
  if (isHtml) headers['Content-Security-Policy'] = CSP;
  return headers;
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, Object.assign(
    {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body)
    },
    securityHeaders(false)
  ));
  res.end(body);
}

function sendError(res, status, code, message) {
  sendJson(res, status, { error: { code, message } });
}

function sendText(res, status, body, extraHeaders) {
  res.writeHead(status, Object.assign(
    {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Length': Buffer.byteLength(body, 'utf8')
    },
    securityHeaders(false),
    extraHeaders || {}
  ));
  res.end(body);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let received = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      received += chunk.length;
      if (received > limit) {
        reject({ tooLarge: true });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ---- LAN / network info -----------------------------------------------

function getLanAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal) {
        addresses.push({ interface: name, address: entry.address });
      }
    }
  }
  return addresses;
}

function buildNetworkInfo(req) {
  const boundToAllInterfaces = HOST === '0.0.0.0' || HOST === '::';
  const lanAddresses = boundToAllInterfaces ? getLanAddresses() : [];
  const hostHeader = (req.headers.host || '').split(':')[0];

  return {
    port: PORT,
    boundHost: HOST,
    lanAvailable: boundToAllInterfaces && lanAddresses.length > 0,
    lanAddresses,
    localUrl: `http://localhost:${PORT}`,
    lanUrls: lanAddresses.map((a) => `http://${a.address}:${PORT}`),
    requestedVia: hostHeader
  };
}

// ---- Static file serving ------------------------------------------------

function safeStaticPath(requestPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(requestPath.split('?')[0]);
  } catch (err) {
    return null; // malformed percent-encoding
  }
  const normalized = path.normalize(decoded).replace(/^(\.\.[/\\])+/, '');
  const resolved = path.join(PUBLIC_DIR, normalized);
  // Prevent path traversal outside of PUBLIC_DIR: the resolved path must
  // sit inside PUBLIC_DIR (or be PUBLIC_DIR itself).
  if (resolved !== PUBLIC_DIR && !resolved.startsWith(PUBLIC_DIR + path.sep)) return null;
  return resolved;
}

function serveStatic(req, res, requestPath) {
  let filePath = safeStaticPath(requestPath === '/' ? '/index.html' : requestPath);
  if (!filePath) {
    return sendError(res, 400, 'bad_path', 'Invalid path.');
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      // SPA fallback: unknown non-API, non-file routes resolve to index.html
      // so client-side routes like #/p/:id work on refresh.
      const indexPath = path.join(PUBLIC_DIR, 'index.html');
      return fs.readFile(indexPath, (err2, data) => {
        if (err2) return sendError(res, 404, 'not_found', 'Not found.');
        res.writeHead(200, Object.assign({ 'Content-Type': MIME_TYPES['.html'] }, securityHeaders(true)));
        res.end(data);
      });
    }

    const ext = path.extname(filePath).toLowerCase();
    const isHtml = ext === '.html';
    fs.readFile(filePath, (readErr, data) => {
      if (readErr) return sendError(res, 500, 'read_failed', 'Could not read file.');
      res.writeHead(200, Object.assign(
        { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' },
        securityHeaders(isHtml)
      ));
      res.end(data);
    });
  });
}

// ---- API handlers ---------------------------------------------------------

function validateCreateBody(body) {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return 'Request body must be a JSON object.';
  }
  if (typeof body.content !== 'string' || body.content.length === 0) {
    return 'Paste content is required.';
  }
  if (Buffer.byteLength(body.content, 'utf8') > MAX_CONTENT_BYTES) {
    const limitLabel = MAX_CONTENT_BYTES >= 1024
      ? `${Math.floor(MAX_CONTENT_BYTES / 1024)} KB`
      : `${MAX_CONTENT_BYTES} bytes`;
    return `Paste content exceeds the ${limitLabel} limit.`;
  }
  if (body.title !== undefined && typeof body.title !== 'string') {
    return 'Title must be a string.';
  }
  if (body.title && body.title.length > 200) {
    return 'Title must be 200 characters or fewer.';
  }
  if (body.language !== undefined && typeof body.language !== 'string') {
    return 'Language must be a string.';
  }
  if (body.language && body.language.length > 40) {
    return 'Language name is too long.';
  }
  if (body.expiration !== undefined && !Object.prototype.hasOwnProperty.call(storage.EXPIRATION_MS, body.expiration)) {
    return 'Unrecognized expiration value.';
  }
  if (body.visibility !== undefined && !['local', 'lan'].includes(body.visibility)) {
    return 'Visibility must be "local" or "lan".';
  }
  return null;
}

function respondWithPasteLookup(res, result) {
  if (result.error === 'invalid_id') return sendError(res, 400, 'invalid_id', 'Invalid paste ID.');
  if (result.error === 'not_found') return sendError(res, 404, 'not_found', 'Paste not found.');
  if (result.error === 'expired') return sendError(res, 410, 'expired', 'This paste has expired.');
  return null; // caller handles the success case
}

async function handleApi(req, res, parsedUrl) {
  const segments = parsedUrl.pathname.split('/').filter(Boolean); // ['api', ...]

  if (segments[1] === 'health' && req.method === 'GET') {
    return sendJson(res, 200, {
      status: 'ok',
      uptimeSeconds: Math.floor(process.uptime()),
      time: new Date().toISOString()
    });
  }

  if (segments[1] === 'network' && req.method === 'GET') {
    return sendJson(res, 200, buildNetworkInfo(req));
  }

  if (segments[1] === 'pastes' && segments.length === 2) {
    if (req.method === 'GET') {
      const pastes = storage.listPastes();
      return sendJson(res, 200, { pastes });
    }

    if (req.method === 'POST') {
      // Reject oversized uploads based on the declared Content-Length
      // before reading anything, so the client gets a clean response
      // instead of the connection being torn down mid-upload.
      const declaredLength = parseInt(req.headers['content-length'], 10);
      if (!Number.isNaN(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
        req.resume(); // drain so the socket can be reused/closed cleanly
        return sendError(res, 413, 'payload_too_large', 'Request body is too large.');
      }

      let raw;
      try {
        raw = await readBody(req, MAX_REQUEST_BYTES);
      } catch (err) {
        if (err && err.tooLarge) {
          return sendError(res, 413, 'payload_too_large', 'Request body is too large.');
        }
        return sendError(res, 400, 'bad_request', 'Could not read request body.');
      }

      let body;
      try {
        body = JSON.parse(raw.toString('utf8') || '{}');
      } catch (err) {
        return sendError(res, 400, 'invalid_json', 'Request body must be valid JSON.');
      }

      const validationError = validateCreateBody(body);
      if (validationError) {
        return sendError(res, 400, 'validation_failed', validationError);
      }

      let paste;
      try {
        paste = storage.createPaste({
          title: body.title ? body.title.trim() : '',
          content: body.content,
          language: body.language || 'plaintext',
          expiration: body.expiration || 'never',
          visibility: body.visibility || 'local'
        });
      } catch (err) {
        console.error('[server] Failed to create paste:', err.message);
        return sendError(res, 500, 'storage_failed', 'Could not save the paste. Please try again.');
      }

      return sendJson(res, 201, { paste });
    }

    return sendError(res, 405, 'method_not_allowed', 'Method not allowed.');
  }

  if (segments[1] === 'pastes' && segments.length === 3) {
    const id = segments[2];

    if (req.method === 'GET') {
      const result = storage.getPaste(id);
      const errorResponse = respondWithPasteLookup(res, result);
      if (errorResponse !== null) return errorResponse;
      return sendJson(res, 200, { paste: result.paste });
    }

    if (req.method === 'DELETE') {
      let ok;
      try {
        ok = storage.deletePaste(id);
      } catch (err) {
        console.error('[server] Failed to delete paste:', err.message);
        return sendError(res, 500, 'storage_failed', 'Could not delete the paste.');
      }
      if (!ok) return sendError(res, 404, 'not_found', 'Paste not found.');
      return sendJson(res, 200, { deleted: true, id });
    }

    return sendError(res, 405, 'method_not_allowed', 'Method not allowed.');
  }

  if (segments[1] === 'pastes' && segments.length === 4 && segments[3] === 'raw') {
    const id = segments[2];
    if (req.method !== 'GET') return sendError(res, 405, 'method_not_allowed', 'Method not allowed.');

    const result = storage.getPaste(id);
    const errorResponse = respondWithPasteLookup(res, result);
    if (errorResponse !== null) return errorResponse;

    return sendText(res, 200, result.paste.content);
  }

  return sendError(res, 404, 'not_found', 'Unknown API route.');
}

// ---- Server ---------------------------------------------------------------

const server = http.createServer((req, res) => {
  let parsedUrl;
  try {
    parsedUrl = url.parse(req.url);
  } catch (err) {
    return sendError(res, 400, 'bad_url', 'Malformed URL.');
  }

  if (parsedUrl.pathname.startsWith('/api/')) {
    handleApi(req, res, parsedUrl).catch((err) => {
      console.error('[server] Unhandled error while handling API request:', err);
      if (!res.headersSent) sendError(res, 500, 'internal_error', 'Something went wrong.');
    });
    return;
  }

  if (parsedUrl.pathname.startsWith('/raw/')) {
    const id = parsedUrl.pathname.split('/')[2];
    const result = storage.getPaste(id);
    const errorResponse = respondWithPasteLookup(res, result);
    if (errorResponse !== null) return errorResponse;
    return sendText(res, 200, result.paste.content);
  }

  serveStatic(req, res, parsedUrl.pathname);
});

// A malformed request line or headers should produce a clean 400, not a
// dropped connection or an uncaught exception.
server.on('clientError', (err, socket) => {
  if (socket.writable) {
    socket.end('HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n');
  }
});

storage.ensureDirs();
storage.cleanupExpired();
const cleanupTimer = setInterval(() => storage.cleanupExpired(), config.CLEANUP_INTERVAL_MS);
cleanupTimer.unref();

function printStartupBanner() {
  const addrs = getLanAddresses();
  console.log('');
  console.log('  Outwiles LocalPaste is running');
  console.log('  --------------------------------');
  console.log(`  Local:    http://localhost:${PORT}`);
  if (HOST === '0.0.0.0' || HOST === '::') {
    if (addrs.length > 0) {
      addrs.forEach((a) => console.log(`  Network:  http://${a.address}:${PORT}  (${a.interface})`));
      console.log('');
      console.log('  Devices on the same Wi-Fi/LAN can open the Network URL above.');
    } else {
      console.log('  Network:  no external network interface detected');
    }
  } else {
    console.log('  Network:  disabled (HOST is set to ' + HOST + ')');
  }
  console.log(`  Data dir: ${storage.DATA_DIR}`);
  console.log('');
}

if (require.main === module) {
  server.listen(PORT, HOST, printStartupBanner);

  // Graceful shutdown: stop accepting new connections, let in-flight
  // requests finish, then exit. Avoids abruptly cutting off a download
  // or an in-progress paste creation when the process is stopped.
  let shuttingDown = false;
  function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n  Received ${signal}, shutting down Outwiles LocalPaste...`);
    server.close(() => {
      console.log('  Stopped.');
      process.exit(0);
    });
    // Failsafe in case some connection never closes.
    setTimeout(() => process.exit(0), 3000).unref();
  }
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  process.on('unhandledRejection', (err) => {
    console.error('[server] Unhandled promise rejection:', err);
  });
  process.on('uncaughtException', (err) => {
    console.error('[server] Uncaught exception:', err);
  });
}

module.exports = server;
