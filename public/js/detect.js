/*!
 * Language detection for Outwiles LocalPaste.
 * Two strategies: filename extension (reliable, used on file import) and a
 * lightweight content heuristic (best-effort, used while typing). When
 * uncertain, both fall back to plaintext rather than guessing.
 */
(function (global) {
  'use strict';

  var EXT_MAP = {
    js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
    ts: 'typescript', tsx: 'typescript',
    py: 'python', pyw: 'python',
    java: 'java',
    c: 'c', h: 'c',
    cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp',
    cs: 'csharp',
    go: 'go',
    rs: 'rust',
    php: 'php',
    rb: 'ruby',
    swift: 'swift',
    kt: 'kotlin', kts: 'kotlin',
    html: 'html', htm: 'html',
    css: 'css',
    json: 'json',
    yml: 'yaml', yaml: 'yaml',
    md: 'markdown', markdown: 'markdown',
    sql: 'sql',
    sh: 'shell', bash: 'shell', zsh: 'shell',
    txt: 'plaintext'
  };

  function detectFromFilename(filename) {
    if (!filename || filename.indexOf('.') === -1) return null;
    var ext = filename.split('.').pop().toLowerCase();
    return EXT_MAP[ext] || null;
  }

  var CONTENT_RULES = [
    { lang: 'json', test: function (t) { var s = t.trim(); return (s.startsWith('{') || s.startsWith('[')) && isJson(s); } },
    { lang: 'html', test: function (t) { return /^\s*<(!DOCTYPE|html|head|body|div|span)/i.test(t); } },
    { lang: 'yaml', test: function (t) { return /^[\w-]+:\s/m.test(t) && !/;\s*$/m.test(t) && /^---/m.test(t) === false && /:\s/.test(t) && !/\bfunction\b|\bdef\b/.test(t); } },
    { lang: 'python', test: function (t) { return /^\s*def\s+\w+\s*\(/m.test(t) || /^\s*import\s+\w+/m.test(t) || /:\s*$/m.test(t) && /^\s*(if|for|while|class|def)\b/m.test(t); } },
    { lang: 'markdown', test: function (t) { return /^#{1,6}\s/m.test(t) || /^\s*[-*]\s/m.test(t) && /\[.*\]\(.*\)/.test(t); } },
    { lang: 'sql', test: function (t) { return /\b(SELECT|INSERT INTO|CREATE TABLE|UPDATE)\b/i.test(t); } },
    { lang: 'shell', test: function (t) { return /^#!\/(bin|usr)\/(bash|sh|env)/.test(t) || /^\s*(sudo|apt-get|export)\s/m.test(t); } },
    { lang: 'go', test: function (t) { return /^\s*package\s+\w+/m.test(t) && /\bfunc\s+\w+\s*\(/.test(t); } },
    { lang: 'rust', test: function (t) { return /\bfn\s+\w+\s*\(/.test(t) && /->|let mut|::/.test(t); } },
    { lang: 'java', test: function (t) { return /\bpublic\s+(class|static)\b/.test(t) && /;\s*$/m.test(t); } },
    { lang: 'csharp', test: function (t) { return /\bnamespace\s+\w+/.test(t) || /\busing\s+System/.test(t); } },
    { lang: 'css', test: function (t) { return /^[.#]?[\w-]+\s*\{[\s\S]*:[\s\S]*\}/m.test(t) && !/function|def /.test(t); } },
    { lang: 'typescript', test: function (t) { return /:\s*(string|number|boolean|any|void)\b/.test(t) && /\b(function|const|let)\b/.test(t); } },
    { lang: 'javascript', test: function (t) { return /\b(function|const|let|var)\b.*[;{]/.test(t) || /=>\s*\{?/.test(t); } },
    { lang: 'php', test: function (t) { return /^\s*<\?php/.test(t); } }
  ];

  function isJson(s) {
    try { JSON.parse(s); return true; } catch (e) { return false; }
  }

  function detectFromContent(content) {
    if (!content || content.trim().length < 3) return null;
    for (var i = 0; i < CONTENT_RULES.length; i++) {
      try {
        if (CONTENT_RULES[i].test(content)) return CONTENT_RULES[i].lang;
      } catch (e) { /* ignore a misbehaving rule */ }
    }
    return null;
  }

  global.OutwilesDetect = {
    fromFilename: detectFromFilename,
    fromContent: detectFromContent
  };
})(typeof window !== 'undefined' ? window : globalThis);
