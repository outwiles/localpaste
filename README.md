# LocalPaste

**A private, self-hosted Pastebin for your local network.**

*Outwiles LocalPaste — Private. Local. Yours.*

LocalPaste runs on your own computer and serves a small, fast Pastebin over `localhost` and your local network. Write or paste some code, get a link back, and open that link from your phone or another computer on the same Wi-Fi — no account, no cloud, no data leaving your network.

```
        Host machine (runs LocalPaste)
                    |
                    | Wi-Fi / LAN
                    |
      +-------------+-------------+
      |             |             |
   Phone         Laptop        Desktop
 (same Wi-Fi)  (same Wi-Fi)  (same Wi-Fi)
```

Any device on the diagram above can open LocalPaste in a browser and use it immediately, as long as it's on the same network as the host machine.

---

## Table of contents

- [Features](#features)
- [Quick start](#quick-start)
- [LAN usage](#lan-usage)
- [Docker](#docker)
- [Configuration](#configuration)
- [Storage](#storage)
- [API](#api)
- [Security](#security)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [Testing](#testing)
- [Contributing](#contributing)
- [Roadmap](#roadmap)
- [License](#license)
- [Credits](#credits)

---

## Features

**Composer**
- Title, code editor, and language selector, with automatic language detection as you type or from a file extension on import
- Expiration (never, 10 minutes, 1 hour, 1 day, 1 week, 1 month) and visibility (local only / LAN accessible)
- File import via picker or drag-and-drop, with clear feedback for empty, oversized, or binary files
- Live line/word/character counts, line numbers, tab handling, and offline syntax highlighting

**Sharing**
- A success screen with the paste's URL, ID, language, expiration, visibility, size, and creation time
- Copy URL, copy content, open, raw view, download, native share (with clipboard fallback), and an offline-generated QR code

**Paste viewer**
- Syntax-highlighted, distraction-free view with line numbers and metadata
- A raw endpoint that returns the exact original content as `text/plain`
- Dedicated "not found" and "expired" states — a bad or stale link never shows a generic server error

**History**
- Every paste created on this instance, with title, language, timestamp, size, expiration, and visibility
- Search by title, ID, or language; sort by newest/oldest/size/title; filter by local/LAN/expired

**LAN sharing**
- A dedicated screen showing the server's real, currently-bound local and network URLs, port, and interface(s) — never hardcoded, and handles multiple network interfaces if more than one is active
- A QR code for each available network URL, generated entirely offline
- Plain-language instructions for connecting a second device, and an explicit explanation of what LAN sharing does and doesn't protect

**Settings**
- Theme (dark/light/system), editor font size, tab size, word wrap, line numbers
- Default language, expiration, and visibility for new pastes — stored in the browser only

**Under the hood**
- Zero npm dependencies — Node.js built-ins only
- File-based JSON storage with atomic writes and automatic recovery from a corrupted index or paste file
- A real backend test suite (`npm test`) and CI that runs it on every push and pull request

## Quick start

Requires [Node.js](https://nodejs.org) 18 or newer. There are no dependencies to install, but `npm install` is safe to run and simply confirms your Node setup.

```bash
git clone https://github.com/outwiles/localpaste.git
cd localpaste
npm start
```

You'll see something like:

```
  Outwiles LocalPaste is running
  --------------------------------
  Local:    http://localhost:8420
  Network:  http://192.168.1.10:8420  (eth0)

  Devices on the same Wi-Fi/LAN can open the Network URL above.
  Data dir: /path/to/localpaste/data
```

Open `http://localhost:8420` in your browser. Stop the server with `Ctrl + C` (or send `SIGINT`/`SIGTERM` — LocalPaste shuts down gracefully, finishing any in-flight request first).

## LAN usage

**`localhost` vs. a LAN IP** — `http://localhost:8420` only ever means "this computer talks to itself." It's not reachable from any other device, even on the same network. A LAN IP like `http://192.168.1.10:8420` is the address this computer has *on your network* — that's the one other devices need.

To reach LocalPaste from a second device:

1. Start LocalPaste on the host machine (`npm start`). Note the `Network:` URL it prints — or open the **LAN** tab in the app, which shows the same information live.
2. Connect the other device to the **same Wi-Fi network** (not a guest network — most guest networks isolate devices from each other on purpose).
3. Open the Network URL in that device's browser, or scan the QR code shown in the LAN tab.

Devices connected to the same network can open the Network URL in their browser and use LocalPaste directly — nothing to install on the second device.

If more than one network interface is active (e.g. both Wi-Fi and Ethernet), the LAN tab lists each one separately with its own URL and QR code, since only one of them may actually be reachable depending on your network setup.

If the LAN tab reports no network URL, LocalPaste couldn't find an active, non-internal network interface, or `HOST` has been set to `127.0.0.1` (which disables network access on purpose — see [Configuration](#configuration)).

## Docker

Docker is entirely optional — plain `npm start` remains fully supported and is not going away.

```bash
docker compose up -d
```

This builds the image, starts the container, and persists paste data to `./data` on the host via a volume, so data survives container restarts and rebuilds. LocalPaste is then reachable at `http://localhost:8420` and, if the host's firewall allows it, at the host's LAN IP.

To use a different host port:

```yaml
# compose.yml
ports:
  - "9000:8420"
```

To build and run without Compose:

```bash
docker build -t outwiles-localpaste .
docker run -d --name localpaste -p 8420:8420 -v "$(pwd)/data:/app/data" outwiles-localpaste
```

## Configuration

All configuration is via environment variables. Every one has a default, so `npm start` works with no configuration at all.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8420` | TCP port the server listens on. |
| `HOST` | `0.0.0.0` | Interface to bind to. `0.0.0.0` listens on all interfaces, which is required for LAN access. Set to `127.0.0.1` to force localhost-only mode and disable network access entirely. |
| `DATA_DIR` | `./data` (relative to the project) | Where pastes and the index are stored. Useful for Docker volumes or keeping data outside the project directory. |
| `MAX_PASTE_SIZE` | `2097152` (2 MB) | Maximum paste content size, in bytes. Requests over this are rejected with `400`. |
| `CLEANUP_INTERVAL_MS` | `300000` (5 minutes) | How often the background sweep removes expired pastes from disk. |

Example:

```bash
PORT=9000 HOST=127.0.0.1 DATA_DIR=/srv/localpaste-data MAX_PASTE_SIZE=5242880 npm start
```

Invalid values (non-numeric or ≤ 0 for numeric settings) are ignored with a warning, and the default is used instead — a typo in an environment variable should never stop the server from starting.

Everything else — theme, editor preferences, and defaults for new pastes — is configured from the **Settings** screen in the app and stored in your browser's `localStorage`. It never touches the server.

## Storage

LocalPaste stores data as plain JSON files under `DATA_DIR` — no database, no external service:

```
data/
├── index.json          # metadata for every paste, used for the History list
└── pastes/
    ├── <id>.json        # one file per paste: title, content, language, timing, visibility
    └── ...
```

- **Writes are atomic.** Every write goes to a temp file first, then an atomic rename replaces the target — a reader never sees a half-written file, and a crash mid-write can't corrupt existing data.
- **Corruption recovers automatically.** If `index.json` is missing or unreadable, LocalPaste rebuilds it by scanning every paste file on disk. If an individual paste file is corrupted, that paste is reported as not found (rather than crashing the server) — it doesn't affect any other paste.
- **Expired pastes** are cleaned up lazily (skipped on read, regardless of the sweep) and periodically by a background sweep (`CLEANUP_INTERVAL_MS`).
- There is currently no enforced total-storage quota — `MAX_PASTE_SIZE` limits any single paste, but disk usage across all pastes is left to the OS/filesystem. See [Roadmap](#roadmap).

## API

All routes are relative to your LocalPaste server (e.g. `http://localhost:8420`). Responses are JSON except the raw endpoints, which return `text/plain`.

| Method | Route | Description |
|---|---|---|
| `GET` | `/api/health` | Server status and uptime. |
| `GET` | `/api/network` | The server's real local/LAN URLs, port, and interface info — reflects how the server is actually bound right now. |
| `GET` | `/api/pastes` | List paste metadata (used by History). Does **not** include paste content. |
| `POST` | `/api/pastes` | Create a paste. |
| `GET` | `/api/pastes/:id` | Get a paste's full content and metadata. |
| `DELETE` | `/api/pastes/:id` | Delete a paste. |
| `GET` | `/api/pastes/:id/raw` | Raw `text/plain` content (also available at the shorter `/raw/:id`). |

### `POST /api/pastes`

Request body (JSON):

```json
{
  "title": "Optional title",
  "content": "required, non-empty string",
  "language": "javascript",
  "expiration": "never | 10m | 1h | 1d | 1w | 1mo",
  "visibility": "local | lan"
}
```

Only `content` is required; every other field has a default (`title`: "Untitled paste", `language`: `plaintext`, `expiration`: `never`, `visibility`: `local`).

Response — `201 Created`:

```json
{
  "paste": {
    "id": "aB3dE9fK",
    "title": "Optional title",
    "content": "required, non-empty string",
    "language": "javascript",
    "expiration": "1h",
    "expiresAt": 1732200000000,
    "visibility": "local",
    "createdAt": 1732196400000,
    "size": 27
  }
}
```

### `GET /api/pastes/:id`, `DELETE /api/pastes/:id`, `GET /api/pastes/:id/raw`

- A well-formed but unknown ID returns `404 not_found`.
- A malformed ID (wrong characters or length) returns `400 invalid_id` — it's rejected before ever touching the filesystem.
- A paste past its expiration returns `410 expired` and is treated as gone (it may still be briefly present on disk until the next cleanup sweep, but is never served).

### Errors

All error responses share one shape:

```json
{ "error": { "code": "validation_failed", "message": "Paste content is required." } }
```

| Status | `code` | Meaning |
|---|---|---|
| `400` | `validation_failed` | The request body failed validation (see message). |
| `400` | `invalid_json` | The request body wasn't valid JSON. |
| `400` | `invalid_id` | The paste ID isn't a valid ID shape. |
| `400` | `bad_path` / `bad_url` | The request path/URL was malformed. |
| `404` | `not_found` | No paste exists with that ID (or the route itself doesn't exist). |
| `405` | `method_not_allowed` | Wrong HTTP method for that route. |
| `410` | `expired` | The paste existed but has passed its expiration. |
| `413` | `payload_too_large` | The request body exceeds the configured size limit. |
| `500` | `internal_error` / `storage_failed` | An unexpected server or disk error. |

### Example

```bash
curl -X POST http://localhost:8420/api/pastes \
  -H "Content-Type: application/json" \
  -d '{"title":"Hello","content":"console.log(\"hi\")","language":"javascript","expiration":"1d","visibility":"local"}'
```

## Security

LocalPaste is built for a trusted local network, not the open internet. Concretely:

- **No authentication by default, and none is added by this release.** Anyone who can reach the server on the network — and who has or guesses a paste's URL — can view that paste. "Local only" vs. "LAN accessible" is a labeling convention shown in the UI; it is **not** a server-side access control, since there is no login system to enforce one against.
- **No encryption at rest, and LAN traffic is plain HTTP.** Don't put anything on LocalPaste that must stay confidential on a network you don't fully trust.
- **Applied regardless of authentication:**
  - Security headers on every response: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy` locking down camera/mic/geolocation/payment/USB, and a `Content-Security-Policy` on HTML pages restricting scripts/styles/fonts/images to this same origin (LocalPaste never loads anything from a CDN or third-party origin).
  - Path-traversal protection on both static file serving and paste IDs (a malformed or traversal-style ID is rejected with `400` before it ever reaches the filesystem).
  - Request size limits: oversized paste content is rejected with `400`, and oversized raw request bodies are rejected with `413` based on `Content-Length` before the server reads them.
  - Malformed JSON, non-object bodies, and unexpected field types are all rejected with clear `400` errors rather than causing a crash or being silently coerced.
  - Uploaded/pasted content is never executed, evaluated, or interpreted as application code — it is stored and displayed as text.
- **Not implemented:** authentication, per-paste access tokens, HTTPS/TLS termination (put a reverse proxy in front of LocalPaste if you need this), rate limiting, and audit logging. See [Roadmap](#roadmap).

If you expose LocalPaste beyond your own trusted network (e.g. via port forwarding to the internet), you are responsible for adding the authentication/TLS layer that decision requires — LocalPaste's threat model assumes a trusted LAN.

## Troubleshooting

**Port already in use.** Run with a different port: `PORT=8421 npm start`.

**Server won't start.** Confirm `node --version` reports 18 or newer, and read the terminal output — LocalPaste logs a specific error rather than failing silently.

**Devices on the network can't connect.**
- *Windows Firewall*: Windows often prompts to allow a new Node.js server through the firewall the first time it binds to a network interface — accept it for **Private networks**. If you missed the prompt, open **Windows Defender Firewall → Allow an app through firewall** and enable Node.js (or add an inbound rule for LocalPaste's port, e.g. TCP 8420) for the Private profile.
- *Linux firewall*: if you use `ufw`, allow the port with `sudo ufw allow 8420/tcp`. For `firewalld`, use `sudo firewall-cmd --add-port=8420/tcp --permanent && sudo firewall-cmd --reload`.
- *Different Wi-Fi networks*: both devices must be on the **same** network. A phone on cellular data (with Wi-Fi off) or a laptop on a different SSID won't be able to reach the host, even if both technically have internet access.
- *Guest networks*: many routers isolate guest-network clients from each other by design — connect both devices to the main network instead.
- *VPN interference*: an active VPN on either device commonly routes all traffic off the local network entirely, which breaks LAN access. Disconnect the VPN (or configure a LAN/split-tunnel exception) and try again.

**LAN tab shows no network URL.** LocalPaste couldn't find an active, non-internal network interface (e.g. Wi-Fi is off), or `HOST` is set to `127.0.0.1`, which disables network access intentionally.

**Clipboard actions don't work.** Some browsers restrict clipboard access to secure contexts (`https://` or `localhost`); accessing LocalPaste via a plain-`http://` LAN address may block it in those browsers. Use the QR code or the visible URL/text as a fallback.

**QR code doesn't scan.** Try more light and holding the camera a bit further back. If generation itself fails, LocalPaste shows an explicit error rather than a blank or broken code.

**Expired or missing paste.** LocalPaste shows a dedicated "This paste has expired" or "Paste not found" screen — this is expected behavior, not a bug.

**Permission errors on startup.** Make sure the account running LocalPaste (or the Docker container's user) has write access to `DATA_DIR`.

## Development

```bash
git clone https://github.com/outwiles/localpaste.git
cd localpaste
npm start
```

There is no build step. The frontend (`public/`) is plain HTML/CSS/JavaScript served directly, and the backend (`server/`) is plain Node.js — editing a file takes effect on the next request or the next restart. To run on a different port while developing without touching your normal instance's data: `PORT=8500 DATA_DIR=./dev-data npm start`.

### Project structure

```
localpaste/
├── server/
│   ├── server.js       # HTTP server: routing, API handlers, security headers, static file serving
│   ├── storage.js       # File-based JSON storage, atomic writes, corruption recovery
│   └── config.js        # Environment variable configuration
├── public/
│   ├── index.html        # Application shell (single-page app)
│   ├── css/styles.css    # Design system and layout
│   └── js/
│       ├── app.js          # Application logic (routing, editor, views)
│       ├── highlight.js    # Offline syntax highlighter
│       ├── detect.js       # Language detection
│       └── qrcode.js       # Offline QR code generator
├── tests/                  # Backend test suite (node:test)
├── .github/workflows/ci.yml
├── Dockerfile / compose.yml / .dockerignore
├── data/                   # Created at runtime: paste storage (git-ignored)
└── package.json
```

## Testing

```bash
npm test
```

This runs the backend test suite using Node's built-in test runner (`node --test`) — no test framework dependency required. Tests spin up real, isolated server instances (random port, temporary data directory) and exercise them over HTTP, plus unit tests against the storage layer directly. Coverage includes: creating, retrieving, listing, and deleting pastes; the raw endpoint; invalid and unknown IDs; expired pastes; invalid expiration/visibility values; oversized content (both the JSON validation path and the raw request-size path); malformed JSON; path traversal attempts; concurrent paste creation; and storage-layer recovery from a corrupted index or a corrupted individual paste file.

CI (`.github/workflows/ci.yml`) runs this suite on every push and pull request against Node 18, 20, and 22, and separately verifies that the server starts and answers `/api/health`.

## Contributing

Issues and pull requests are welcome at the [GitHub repository](https://github.com/outwiles/localpaste). Before submitting a change:

- Keep the zero-dependency, local-first approach — avoid adding external runtime dependencies, frameworks, or network calls unless there's a strong, specific reason.
- Don't add authentication, accounts, analytics, tracking, or AI/LLM functionality — these are explicitly outside this project's scope.
- Run `npm test` and make sure it passes; add tests for new behavior rather than just for coverage numbers.
- Update this README if you add, remove, or change a user-facing feature or an environment variable.

## Roadmap

Things LocalPaste does **not** currently do, listed here rather than left unmentioned:

- Optional authentication or a per-paste access token, for people who want stronger access control than "the visibility label is a convention."
- Optional HTTPS/TLS support (currently: put a reverse proxy in front of it if you need this).
- Full-text search across paste *content* in History (search currently covers title, ID, and language only — searching content would mean loading every paste's body, which the current lightweight index deliberately avoids).
- An enforced total-storage quota across all pastes combined (today, `MAX_PASTE_SIZE` only limits a single paste).
- Rate limiting on paste creation.

None of these are implemented today — this list exists so the README never implies otherwise.

## License

MIT — see [LICENSE](LICENSE).

---

## Credits

<p align="center">
  <b>Developed by Aashu</b><br/><br/>
  <a href="https://t.me/outwiles">
    <img src="https://img.shields.io/badge/Telegram-@outwiles-26A5E4?style=for-the-badge&logo=telegram&logoColor=white" alt="Telegram" />
  </a>
  <a href="https://github.com/outwiles">
    <img src="https://img.shields.io/badge/GitHub-@outwiles-181717?style=for-the-badge&logo=github&logoColor=white" alt="GitHub" />
  </a>
  <a href="mailto:outwiles@proton.me">
    <img src="https://img.shields.io/badge/Mail-outwiles%40proton.me-D14836?style=for-the-badge&logo=protonmail&logoColor=white" alt="Mail" />
  </a>
</p>
