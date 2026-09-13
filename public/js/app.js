(function () {
  'use strict';

  // ---------------------------------------------------------------------
  // Settings (persisted in localStorage — nothing here ever leaves the browser)
  // ---------------------------------------------------------------------
  var SETTINGS_KEY = 'outwiles.settings.v1';
  var DEFAULT_SETTINGS = {
    theme: 'system',
    fontSize: '14',
    tabSize: '2',
    wordWrap: true,
    lineNumbers: true,
    defaultLanguage: 'auto',
    defaultExpiration: 'never',
    defaultVisibility: 'local'
  };

  function loadSettings() {
    try {
      var raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return Object.assign({}, DEFAULT_SETTINGS);
      return Object.assign({}, DEFAULT_SETTINGS, JSON.parse(raw));
    } catch (e) {
      return Object.assign({}, DEFAULT_SETTINGS);
    }
  }

  function saveSettings(settings) {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (e) {
      // Storage might be unavailable (private mode, quota) — fail silently,
      // settings simply won't persist across reloads.
    }
  }

  var settings = loadSettings();

  // ---------------------------------------------------------------------
  // Theme
  // ---------------------------------------------------------------------
  function applyTheme() {
    var mode = settings.theme;
    var resolved = mode;
    if (mode === 'system') {
      resolved = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    }
    document.documentElement.setAttribute('data-theme', resolved);
  }
  applyTheme();
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', function () {
    if (settings.theme === 'system') applyTheme();
  });

  function cycleTheme() {
    var order = ['system', 'dark', 'light'];
    var idx = order.indexOf(settings.theme);
    settings.theme = order[(idx + 1) % order.length];
    saveSettings(settings);
    applyTheme();
    syncSettingsForm();
    var label = settings.theme === 'system' ? 'Following system theme' : settings.theme + ' theme';
    toast(label);
  }

  // ---------------------------------------------------------------------
  // Toasts
  // ---------------------------------------------------------------------
  var toastRegion = document.getElementById('toast-region');
  function toast(message, kind) {
    var el = document.createElement('div');
    el.className = 'toast' + (kind ? ' is-' + kind : '');
    el.textContent = message;
    toastRegion.appendChild(el);
    setTimeout(function () {
      el.style.opacity = '0';
      setTimeout(function () { el.remove(); }, 200);
    }, 3200);
  }

  // ---------------------------------------------------------------------
  // API helpers
  // ---------------------------------------------------------------------
  function api(path, options) {
    return fetch('/api' + path, options).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) {
          var message = (data && data.error && data.error.message) || ('Request failed (' + res.status + ')');
          var err = new Error(message);
          err.status = res.status;
          err.code = data && data.error && data.error.code;
          throw err;
        }
        return data;
      });
    });
  }

  function createPasteRequest(payload) {
    return api('/pastes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  }
  function fetchPaste(id) { return api('/pastes/' + encodeURIComponent(id)); }
  function deletePasteRequest(id) { return api('/pastes/' + encodeURIComponent(id), { method: 'DELETE' }); }
  function listPastesRequest() { return api('/pastes'); }
  function fetchNetworkInfo() { return api('/network'); }

  // ---------------------------------------------------------------------
  // Formatting helpers
  // ---------------------------------------------------------------------
  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }
  function formatDate(ts) {
    var d = new Date(ts);
    return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }
  var EXPIRATION_LABELS = { never: 'Never', '10m': '10 minutes', '1h': '1 hour', '1d': '1 day', '1w': '1 week', '1mo': '1 month' };
  function expirationLabel(paste) {
    if (!paste.expiresAt) return 'Never';
    if (Date.now() > paste.expiresAt) return 'Expired';
    return 'Expires ' + formatDate(paste.expiresAt);
  }
  function languageLabel(lang) {
    var map = { plaintext: 'Plain text', javascript: 'JavaScript', typescript: 'TypeScript', csharp: 'C#', cpp: 'C++', sql: 'SQL', html: 'HTML', css: 'CSS', json: 'JSON', yaml: 'YAML', shell: 'Shell', php: 'PHP' };
    return map[lang] || (lang ? lang.charAt(0).toUpperCase() + lang.slice(1) : 'Plain text');
  }
  function pasteUrl(id) { return window.location.origin + '/p/' + id; }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      return false;
    }
  }

  function downloadPaste(paste) {
    var extMap = { javascript: 'js', typescript: 'ts', python: 'py', java: 'java', c: 'c', cpp: 'cpp', csharp: 'cs', go: 'go', rust: 'rs', php: 'php', ruby: 'rb', swift: 'swift', kotlin: 'kt', html: 'html', css: 'css', json: 'json', yaml: 'yml', markdown: 'md', sql: 'sql', shell: 'sh', plaintext: 'txt' };
    var ext = extMap[paste.language] || 'txt';
    var base = (paste.title || 'paste').trim().replace(/[^\w\-]+/g, '-').replace(/^-+|-+$/g, '') || 'paste';
    var filename = base.toLowerCase().endsWith('.' + ext) ? base : base + '.' + ext;
    var blob = new Blob([paste.content], { type: 'text/plain;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }

  async function sharePaste(paste) {
    var url = pasteUrl(paste.id);
    if (navigator.share) {
      try {
        await navigator.share({ title: paste.title || 'Paste', url: url });
        return;
      } catch (e) {
        if (e && e.name === 'AbortError') return;
        // fall through to clipboard fallback
      }
    }
    var ok = await copyText(url);
    toast(ok ? 'Link copied to clipboard' : 'Could not access the clipboard', ok ? 'success' : 'error');
  }

  function renderQr(url) {
    var canvas = document.getElementById('qr-canvas');
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    try {
      var qr = window.OutwilesQR.generate(url);
      var scale = Math.floor(canvas.width / (qr.size + 2));
      var offset = Math.floor((canvas.width - scale * qr.size) / 2);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#0B0D10';
      for (var r = 0; r < qr.size; r++) {
        for (var c = 0; c < qr.size; c++) {
          if (qr.modules[r][c]) {
            ctx.fillRect(offset + c * scale, offset + r * scale, scale, scale);
          }
        }
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  function openQrDialog(url) {
    var dialog = document.getElementById('qr-dialog');
    var ok = renderQr(url);
    document.getElementById('qr-url').textContent = url;
    if (!ok) toast('Could not generate a QR code for this URL', 'error');
    dialog.showModal();
  }
  document.getElementById('qr-close-btn').addEventListener('click', function () {
    document.getElementById('qr-dialog').close();
  });
  document.getElementById('qr-copy-btn').addEventListener('click', async function () {
    var url = document.getElementById('qr-url').textContent;
    var ok = await copyText(url);
    toast(ok ? 'URL copied' : 'Could not access the clipboard', ok ? 'success' : 'error');
  });

  // ---------------------------------------------------------------------
  // Delete confirmation dialog
  // ---------------------------------------------------------------------
  var deleteDialog = document.getElementById('delete-dialog');
  var pendingDelete = null;
  function confirmDelete(id, title, onDeleted) {
    pendingDelete = { id: id, onDeleted: onDeleted };
    document.getElementById('delete-dialog-title').textContent = title || 'this paste';
    deleteDialog.showModal();
  }
  document.getElementById('delete-dialog-cancel').addEventListener('click', function () {
    deleteDialog.close();
  });
  deleteDialog.addEventListener('close', function () {
    pendingDelete = null;
  });
  document.getElementById('delete-dialog-confirm').addEventListener('click', async function () {
    if (!pendingDelete) return;
    var target = pendingDelete;
    try {
      await deletePasteRequest(target.id);
      toast('Paste deleted', 'success');
      if (target.onDeleted) target.onDeleted();
    } catch (e) {
      toast(e.message || 'Could not delete paste', 'error');
    }
    pendingDelete = null;
    deleteDialog.close();
  });

  // ---------------------------------------------------------------------
  // Router
  // ---------------------------------------------------------------------
  var VIEWS = ['compose', 'history', 'lan', 'settings', 'viewer'];
  var HEADINGS = { compose: 'Compose', history: 'History', lan: 'LAN sharing', settings: 'Settings', viewer: 'Paste' };

  function showView(name) {
    VIEWS.forEach(function (v) {
      document.getElementById('view-' + v).hidden = v !== name;
    });
    document.querySelectorAll('.rail-link').forEach(function (btn) {
      btn.setAttribute('aria-selected', String(btn.dataset.route === name));
    });
    document.getElementById('topbar-heading').textContent = HEADINGS[name] || '';
    closeMobileNav();
  }

  function route() {
    var hash = window.location.hash.replace(/^#\/?/, '');
    if (hash.startsWith('p/')) {
      var id = hash.slice(2);
      showView('viewer');
      loadPasteView(id);
      return;
    }
    if (hash === 'history') { showView('history'); loadHistory(); return; }
    if (hash === 'lan') { showView('lan'); loadLanInfo(); return; }
    if (hash === 'settings') { showView('settings'); return; }
    showView('compose');
  }
  window.addEventListener('hashchange', route);

  document.querySelectorAll('.rail-link').forEach(function (btn) {
    btn.addEventListener('click', function () {
      window.location.hash = '#/' + btn.dataset.route;
    });
  });

  // Mobile nav toggle
  var mobileNavToggle = document.getElementById('mobile-nav-toggle');
  var mobileNavBackdrop = document.getElementById('mobile-nav-backdrop');
  var rail = document.querySelector('.rail');
  mobileNavToggle.addEventListener('click', function () {
    var opening = !rail.classList.contains('is-open');
    rail.classList.toggle('is-open', opening);
    mobileNavBackdrop.hidden = !opening;
    mobileNavToggle.setAttribute('aria-expanded', String(opening));
  });
  mobileNavBackdrop.addEventListener('click', closeMobileNav);
  function closeMobileNav() {
    rail.classList.remove('is-open');
    mobileNavBackdrop.hidden = true;
    mobileNavToggle.setAttribute('aria-expanded', 'false');
  }

  document.getElementById('theme-toggle').addEventListener('click', cycleTheme);

  // ---------------------------------------------------------------------
  // Composer / editor
  // ---------------------------------------------------------------------
  var textarea = document.getElementById('editor-textarea');
  var highlightCode = document.getElementById('editor-highlight-code');
  var highlightPre = document.getElementById('editor-highlight');
  var gutter = document.getElementById('editor-gutter');
  var editorShell = document.getElementById('editor-shell');
  var titleInput = document.getElementById('paste-title');
  var languageSelect = document.getElementById('language-select');
  var expirationSelect = document.getElementById('expiration-select');
  var detectedHint = document.getElementById('detected-hint');
  var visibilityHint = document.getElementById('visibility-hint');
  var createBtn = document.getElementById('create-btn');
  var createBtnLabel = document.getElementById('create-btn-label');

  var currentVisibility = settings.defaultVisibility;
  var currentDetectedLanguage = null;
  var isSubmitting = false;
  var lastImportedFilename = null;

  function applyEditorSettings() {
    textarea.style.fontSize = settings.fontSize + 'px';
    highlightPre.style.fontSize = settings.fontSize + 'px';
    gutter.style.fontSize = settings.fontSize + 'px';
    editorShell.classList.toggle('word-wrap', !!settings.wordWrap);
    gutter.style.display = settings.lineNumbers ? '' : 'none';
  }
  applyEditorSettings();

  languageSelect.value = settings.defaultLanguage;
  expirationSelect.value = settings.defaultExpiration;
  setVisibility(settings.defaultVisibility);

  function setVisibility(value) {
    currentVisibility = value;
    document.querySelectorAll('.segmented-btn').forEach(function (btn) {
      var active = btn.dataset.visibility === value;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-checked', String(active));
    });
    visibilityHint.textContent = value === 'lan'
      ? 'Reachable from other devices on this network while the server runs.'
      : 'Only reachable from this machine.';
  }
  document.querySelectorAll('.segmented-btn').forEach(function (btn, i, all) {
    btn.addEventListener('click', function () { setVisibility(btn.dataset.visibility); btn.focus(); });
    btn.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      var next = e.key === 'ArrowRight' ? (i + 1) % all.length : (i - 1 + all.length) % all.length;
      setVisibility(all[next].dataset.visibility);
      all[next].focus();
    });
  });

  function currentLanguage() {
    if (languageSelect.value === 'auto') return currentDetectedLanguage || 'plaintext';
    return languageSelect.value;
  }

  function updateGutter() {
    var lineCount = textarea.value.split('\n').length;
    var lines = [];
    for (var i = 1; i <= lineCount; i++) lines.push(i);
    gutter.textContent = lines.join('\n');
  }

  function updateCounts() {
    var content = textarea.value;
    var lines = content.length === 0 ? 0 : content.split('\n').length;
    var words = content.trim().length === 0 ? 0 : content.trim().split(/\s+/).length;
    document.getElementById('count-lines').textContent = lines + (lines === 1 ? ' line' : ' lines');
    document.getElementById('count-words').textContent = words + (words === 1 ? ' word' : ' words');
    document.getElementById('count-chars').textContent = content.length + (content.length === 1 ? ' char' : ' chars');
  }

  var highlightTimer = null;
  function scheduleHighlight() {
    clearTimeout(highlightTimer);
    highlightTimer = setTimeout(runHighlight, 60);
  }
  function runHighlight() {
    var content = textarea.value;
    if (languageSelect.value === 'auto') {
      var detected = content.length > 0 ? window.OutwilesDetect.fromContent(content) : null;
      currentDetectedLanguage = detected;
      detectedHint.textContent = detected ? 'Detected as ' + languageLabel(detected) : 'Detects as you type';
    }
    var lines = window.OutwilesHighlight.highlight(content, currentLanguage());
    highlightCode.innerHTML = lines.join('\n') || '';
  }

  function syncEditorScroll() {
    highlightPre.scrollTop = textarea.scrollTop;
    highlightPre.scrollLeft = textarea.scrollLeft;
    gutter.scrollTop = textarea.scrollTop;
  }

  textarea.addEventListener('input', function () {
    updateGutter();
    updateCounts();
    scheduleHighlight();
  });
  textarea.addEventListener('scroll', syncEditorScroll);

  textarea.addEventListener('keydown', function (e) {
    if (e.key === 'Tab') {
      e.preventDefault();
      var tabSize = parseInt(settings.tabSize, 10) || 2;
      var spaces = ' '.repeat(tabSize);
      var start = textarea.selectionStart, end = textarea.selectionEnd;
      textarea.value = textarea.value.slice(0, start) + spaces + textarea.value.slice(end);
      textarea.selectionStart = textarea.selectionEnd = start + spaces.length;
      textarea.dispatchEvent(new Event('input'));
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleCreate();
    }
  });

  languageSelect.addEventListener('change', function () {
    detectedHint.textContent = languageSelect.value === 'auto' ? 'Detects as you type' : 'Manually selected';
    runHighlight();
  });

  // ---- File import / drag & drop ----
  var MAX_IMPORT_BYTES = 2 * 1024 * 1024;
  var BINARY_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf', 'zip', 'exe', 'dll', 'mp3', 'mp4', 'mov', 'ico', 'woff', 'woff2', 'ttf', 'bin'];

  function importFile(file) {
    if (!file) return;
    var ext = file.name.includes('.') ? file.name.split('.').pop().toLowerCase() : '';
    if (BINARY_EXTENSIONS.includes(ext)) {
      toast('"' + file.name + '" looks like a binary file and can\'t be pasted as text', 'error');
      return;
    }
    if (file.size === 0) {
      toast('"' + file.name + '" is empty', 'error');
      return;
    }
    if (file.size > MAX_IMPORT_BYTES) {
      toast('"' + file.name + '" is larger than the 2 MB import limit', 'error');
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      var text = reader.result;
      // Heuristic binary guard: a high proportion of control/replacement
      // characters suggests this isn't really text.
      var suspicious = (text.match(/\uFFFD/g) || []).length;
      if (suspicious > text.length * 0.01 && text.length > 0) {
        toast('"' + file.name + '" doesn\'t look like a text file', 'error');
        return;
      }
      textarea.value = text;
      textarea.dispatchEvent(new Event('input'));
      lastImportedFilename = file.name;
      if (!titleInput.value.trim()) titleInput.value = file.name;
      var detected = window.OutwilesDetect.fromFilename(file.name);
      if (detected) {
        languageSelect.value = detected;
        currentDetectedLanguage = detected;
        detectedHint.textContent = 'Detected from file extension';
        runHighlight();
      }
      toast('Imported ' + file.name, 'success');
    };
    reader.onerror = function () {
      toast('Could not read "' + file.name + '" — permission denied or unreadable', 'error');
    };
    reader.readAsText(file);
  }

  document.getElementById('file-input').addEventListener('change', function (e) {
    importFile(e.target.files[0]);
    e.target.value = '';
  });

  var dropZone = document.getElementById('composer-drop-zone');
  var dragCounter = 0;
  ['dragenter', 'dragover'].forEach(function (evt) {
    dropZone.addEventListener(evt, function (e) {
      e.preventDefault();
      dragCounter++;
      editorShell.classList.add('dragging');
    });
  });
  ['dragleave', 'dragend'].forEach(function (evt) {
    dropZone.addEventListener(evt, function (e) {
      dragCounter = Math.max(0, dragCounter - 1);
      if (dragCounter === 0) editorShell.classList.remove('dragging');
    });
  });
  dropZone.addEventListener('drop', function (e) {
    e.preventDefault();
    dragCounter = 0;
    editorShell.classList.remove('dragging');
    var file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) importFile(file);
  });

  // ---- Clear ----
  document.getElementById('clear-btn').addEventListener('click', function () {
    textarea.value = '';
    titleInput.value = '';
    lastImportedFilename = null;
    languageSelect.value = settings.defaultLanguage;
    currentDetectedLanguage = null;
    detectedHint.textContent = 'Detects as you type';
    textarea.dispatchEvent(new Event('input'));
    textarea.focus();
  });

  // ---- Create paste ----
  var lastCreatedPaste = null;

  async function handleCreate() {
    if (isSubmitting) return;
    var content = textarea.value;
    if (!content.trim()) {
      toast('Write or import something before creating a paste', 'error');
      textarea.focus();
      return;
    }
    isSubmitting = true;
    createBtn.disabled = true;
    createBtnLabel.textContent = 'Creating…';

    try {
      var res = await createPasteRequest({
        title: titleInput.value.trim(),
        content: content,
        language: currentLanguage(),
        expiration: expirationSelect.value,
        visibility: currentVisibility
      });
      lastCreatedPaste = res.paste;
      showSuccessPanel(res.paste);
      refreshHistoryCacheSoon();
    } catch (e) {
      toast(e.message || 'Could not create paste', 'error');
    } finally {
      isSubmitting = false;
      createBtn.disabled = false;
      createBtnLabel.textContent = 'Create paste';
    }
  }
  createBtn.addEventListener('click', handleCreate);

  function showSuccessPanel(paste) {
    document.querySelector('.composer').style.display = 'none';
    var panel = document.getElementById('success-panel');
    panel.hidden = false;
    var url = pasteUrl(paste.id);
    document.getElementById('success-url').textContent = url;
    document.getElementById('success-id').textContent = paste.id;
    document.getElementById('success-language').textContent = languageLabel(paste.language);
    document.getElementById('success-expiration').textContent = expirationLabel(paste);
    document.getElementById('success-visibility').textContent = paste.visibility === 'lan' ? 'LAN accessible' : 'Local only';
    document.getElementById('success-size').textContent = formatBytes(paste.size);
    document.getElementById('success-created').textContent = formatDate(paste.createdAt);
  }

  function resetComposerAfterSuccess() {
    document.querySelector('.composer').style.display = '';
    document.getElementById('success-panel').hidden = true;
    textarea.value = '';
    titleInput.value = '';
    languageSelect.value = settings.defaultLanguage;
    expirationSelect.value = settings.defaultExpiration;
    setVisibility(settings.defaultVisibility);
    currentDetectedLanguage = null;
    detectedHint.textContent = 'Detects as you type';
    textarea.dispatchEvent(new Event('input'));
  }

  document.getElementById('copy-url-btn').addEventListener('click', async function () {
    var ok = await copyText(document.getElementById('success-url').textContent);
    toast(ok ? 'URL copied' : 'Could not access the clipboard', ok ? 'success' : 'error');
  });
  document.getElementById('success-open-btn').addEventListener('click', function () {
    if (lastCreatedPaste) window.location.hash = '#/p/' + lastCreatedPaste.id;
  });
  document.getElementById('success-raw-btn').addEventListener('click', function () {
    if (lastCreatedPaste) window.open('/raw/' + lastCreatedPaste.id, '_blank', 'noopener');
  });
  document.getElementById('success-download-btn').addEventListener('click', function () {
    if (lastCreatedPaste) downloadPaste(lastCreatedPaste);
  });
  document.getElementById('success-share-btn').addEventListener('click', function () {
    if (lastCreatedPaste) sharePaste(lastCreatedPaste);
  });
  document.getElementById('success-qr-btn').addEventListener('click', function () {
    if (lastCreatedPaste) openQrDialog(pasteUrl(lastCreatedPaste.id));
  });
  document.getElementById('success-delete-btn').addEventListener('click', function () {
    if (!lastCreatedPaste) return;
    confirmDelete(lastCreatedPaste.id, lastCreatedPaste.title, function () {
      resetComposerAfterSuccess();
      refreshHistoryCacheSoon();
    });
  });
  document.getElementById('success-new-btn').addEventListener('click', resetComposerAfterSuccess);

  // ---------------------------------------------------------------------
  // Viewer
  // ---------------------------------------------------------------------
  async function loadPasteView(id) {
    var loading = document.getElementById('viewer-loading');
    var notFound = document.getElementById('viewer-not-found');
    var expired = document.getElementById('viewer-expired');
    var content = document.getElementById('viewer-content');
    loading.hidden = false;
    notFound.hidden = true;
    expired.hidden = true;
    content.hidden = true;

    try {
      var res = await fetchPaste(id);
      var paste = res.paste;
      loading.hidden = true;
      content.hidden = false;

      document.getElementById('viewer-title').textContent = paste.title || 'Untitled paste';
      document.getElementById('viewer-language-badge').textContent = languageLabel(paste.language);
      document.getElementById('viewer-created').textContent = formatDate(paste.createdAt);
      document.getElementById('viewer-size').textContent = formatBytes(paste.size);
      document.getElementById('viewer-expiration').textContent = expirationLabel(paste);
      document.getElementById('viewer-visibility').textContent = paste.visibility === 'lan' ? 'LAN accessible' : 'Local only';
      var lineCount = paste.content.split('\n').length;
      document.getElementById('viewer-lines').textContent = String(lineCount);

      var gutterLines = [];
      for (var i = 1; i <= lineCount; i++) gutterLines.push(i);
      document.getElementById('viewer-gutter').textContent = gutterLines.join('\n');
      document.getElementById('viewer-code').innerHTML = window.OutwilesHighlight.highlight(paste.content, paste.language).join('\n');

      document.getElementById('viewer-copy-btn').onclick = async function () {
        var ok = await copyText(paste.content);
        toast(ok ? 'Content copied' : 'Could not access the clipboard', ok ? 'success' : 'error');
      };
      document.getElementById('viewer-raw-btn').onclick = function () { window.open('/raw/' + paste.id, '_blank', 'noopener'); };
      document.getElementById('viewer-download-btn').onclick = function () { downloadPaste(paste); };
      document.getElementById('viewer-share-btn').onclick = function () { sharePaste(paste); };
      document.getElementById('viewer-qr-btn').onclick = function () { openQrDialog(pasteUrl(paste.id)); };
      document.getElementById('viewer-delete-btn').onclick = function () {
        confirmDelete(paste.id, paste.title, function () {
          window.location.hash = '#/history';
          refreshHistoryCacheSoon();
        });
      };
    } catch (e) {
      loading.hidden = true;
      if (e.status === 410) {
        expired.hidden = false;
      } else {
        notFound.hidden = false;
      }
    }
  }

  // ---------------------------------------------------------------------
  // History
  // ---------------------------------------------------------------------
  var historyCache = [];
  var historySearchInput = document.getElementById('history-search');
  var historySortSelect = document.getElementById('history-sort');
  var historyFilterSelect = document.getElementById('history-filter');

  async function loadHistory() {
    try {
      var res = await listPastesRequest();
      historyCache = res.pastes || [];
      renderHistory();
    } catch (e) {
      toast('Could not load history: ' + (e.message || 'server unavailable'), 'error');
    }
  }

  function refreshHistoryCacheSoon() {
    if (window.location.hash.replace(/^#\/?/, '') === 'history') {
      setTimeout(loadHistory, 200);
    }
  }

  function renderHistory() {
    var query = historySearchInput.value.trim().toLowerCase();
    var sort = historySortSelect.value;
    var filter = historyFilterSelect.value;

    var items = historyCache.filter(function (p) {
      if (filter === 'local' && p.visibility !== 'local') return false;
      if (filter === 'lan' && p.visibility !== 'lan') return false;
      if (filter === 'expired' && !p.expired) return false;
      if (!query) return true;
      return (
        (p.title || '').toLowerCase().includes(query) ||
        p.id.toLowerCase().includes(query) ||
        (p.language || '').toLowerCase().includes(query)
      );
    });

    items.sort(function (a, b) {
      if (sort === 'oldest') return a.createdAt - b.createdAt;
      if (sort === 'largest') return b.size - a.size;
      if (sort === 'title') return (a.title || '').localeCompare(b.title || '');
      return b.createdAt - a.createdAt;
    });

    var list = document.getElementById('history-list');
    var empty = document.getElementById('history-empty');
    var noResults = document.getElementById('history-no-results');

    if (historyCache.length === 0) {
      list.hidden = true; noResults.hidden = true; empty.hidden = false;
      return;
    }
    empty.hidden = true;

    if (items.length === 0) {
      list.hidden = true; noResults.hidden = false;
      return;
    }
    noResults.hidden = true;
    list.hidden = false;

    list.innerHTML = '';
    items.forEach(function (p) {
      var li = document.createElement('li');
      li.className = 'history-item';
      li.tabIndex = 0;
      li.setAttribute('role', 'button');
      li.setAttribute('aria-label', 'Open ' + (p.title || 'untitled paste'));

      var main = document.createElement('div');
      main.className = 'history-item-main';
      var title = document.createElement('div');
      title.className = 'history-item-title';
      title.textContent = p.title || 'Untitled paste';
      var meta = document.createElement('div');
      meta.className = 'history-item-meta';
      meta.innerHTML =
        '<span>' + languageLabel(p.language) + '</span>' +
        '<span>' + formatDate(p.createdAt) + '</span>' +
        '<span>' + formatBytes(p.size) + '</span>' +
        '<span>' + (p.visibility === 'lan' ? 'LAN' : 'Local') + '</span>' +
        (p.expired ? '<span class="expired-tag">Expired</span>' : '');
      main.appendChild(title);
      main.appendChild(meta);

      var actions = document.createElement('div');
      actions.className = 'history-item-actions';

      var copyBtn = document.createElement('button');
      copyBtn.className = 'btn btn-ghost btn-sm';
      copyBtn.textContent = 'Copy link';
      copyBtn.addEventListener('click', async function (e) {
        e.stopPropagation();
        var ok = await copyText(pasteUrl(p.id));
        toast(ok ? 'Link copied' : 'Could not access the clipboard', ok ? 'success' : 'error');
      });

      var deleteBtn = document.createElement('button');
      deleteBtn.className = 'btn btn-danger-ghost btn-sm';
      deleteBtn.textContent = 'Delete';
      deleteBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        confirmDelete(p.id, p.title, loadHistory);
      });

      actions.appendChild(copyBtn);
      actions.appendChild(deleteBtn);

      li.appendChild(main);
      li.appendChild(actions);

      function open() { window.location.hash = '#/p/' + p.id; }
      li.addEventListener('click', open);
      li.addEventListener('keydown', function (e) { if (e.key === 'Enter') open(); });

      list.appendChild(li);
    });
  }

  historySearchInput.addEventListener('input', function () {
    document.getElementById('history-search-clear').hidden = !historySearchInput.value;
    renderHistory();
  });
  document.getElementById('history-search-clear').addEventListener('click', function () {
    historySearchInput.value = '';
    this.hidden = true;
    renderHistory();
    historySearchInput.focus();
  });
  historySortSelect.addEventListener('change', renderHistory);
  historyFilterSelect.addEventListener('change', renderHistory);

  // ---------------------------------------------------------------------
  // LAN
  // ---------------------------------------------------------------------
  async function loadLanInfo() {
    var dot = document.getElementById('lan-status-dot');
    var text = document.getElementById('lan-status-text');
    var list = document.getElementById('lan-network-list');
    list.innerHTML = '';

    try {
      var info = await fetchNetworkInfo();
      document.getElementById('lan-local-url').textContent = info.localUrl;
      document.getElementById('lan-port').textContent = String(info.port);

      if (info.lanAvailable) {
        dot.className = 'status-dot is-live';
        text.textContent = info.lanUrls.length > 1
          ? 'Multiple network interfaces are available — other devices can use any of the URLs below'
          : 'The network URL below is reachable from other devices on this Wi-Fi/LAN';

        info.lanAddresses.forEach(function (addr, i) {
          var url = info.lanUrls[i];
          var row = document.createElement('div');
          row.className = 'lan-network-row';

          var info_ = document.createElement('div');
          info_.className = 'lan-network-row-info';
          info_.innerHTML =
            '<div class="lan-network-row-url">' + url + '</div>' +
            '<div class="lan-network-row-iface">' + addr.interface + '</div>';

          var qrBtn = document.createElement('button');
          qrBtn.type = 'button';
          qrBtn.className = 'btn btn-secondary btn-sm';
          qrBtn.textContent = 'QR code';
          qrBtn.addEventListener('click', function () { openQrDialog(url); });

          row.appendChild(info_);
          row.appendChild(qrBtn);
          list.appendChild(row);
        });
      } else {
        dot.className = 'status-dot is-off';
        text.textContent = 'Network access is not available right now — no external network interface was detected.';
      }
    } catch (e) {
      dot.className = 'status-dot is-off';
      text.textContent = 'Could not reach the LocalPaste server';
    }
  }

  // ---------------------------------------------------------------------
  // Settings form
  // ---------------------------------------------------------------------
  function syncSettingsForm() {
    document.getElementById('setting-theme').value = settings.theme;
    document.getElementById('setting-font-size').value = settings.fontSize;
    document.getElementById('setting-tab-size').value = settings.tabSize;
    document.getElementById('setting-word-wrap').checked = settings.wordWrap;
    document.getElementById('setting-line-numbers').checked = settings.lineNumbers;
    document.getElementById('setting-default-language').value = settings.defaultLanguage;
    document.getElementById('setting-default-expiration').value = settings.defaultExpiration;
    document.getElementById('setting-default-visibility').value = settings.defaultVisibility;
  }
  syncSettingsForm();

  function bindSetting(id, key, kind) {
    document.getElementById(id).addEventListener('change', function (e) {
      settings[key] = kind === 'checkbox' ? e.target.checked : e.target.value;
      saveSettings(settings);
      if (key === 'theme') applyTheme();
      if (['fontSize', 'wordWrap', 'lineNumbers'].includes(key)) applyEditorSettings();
    });
  }
  bindSetting('setting-theme', 'theme');
  bindSetting('setting-font-size', 'fontSize');
  bindSetting('setting-tab-size', 'tabSize');
  bindSetting('setting-word-wrap', 'wordWrap', 'checkbox');
  bindSetting('setting-line-numbers', 'lineNumbers', 'checkbox');
  bindSetting('setting-default-language', 'defaultLanguage');
  bindSetting('setting-default-expiration', 'defaultExpiration');
  bindSetting('setting-default-visibility', 'defaultVisibility');

  // ---------------------------------------------------------------------
  // Global keyboard shortcuts
  // ---------------------------------------------------------------------
  document.addEventListener('keydown', function (e) {
    var tag = (document.activeElement && document.activeElement.tagName) || '';
    var typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

    if (e.key === '/' && !typing && window.location.hash.includes('history')) {
      e.preventDefault();
      historySearchInput.focus();
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && !typing) {
      e.preventDefault();
      window.location.hash = '#/history';
      setTimeout(function () { historySearchInput.focus(); }, 50);
    }
    if (e.key === 'Escape') {
      if (deleteDialog.open) deleteDialog.close();
      var qrDialog = document.getElementById('qr-dialog');
      if (qrDialog.open) qrDialog.close();
      if (rail.classList.contains('is-open')) closeMobileNav();
    }
  });

  // Clicking the backdrop area of a native <dialog> (outside its content
  // box) closes it — clicking inside the dialog's own content never does.
  [deleteDialog, document.getElementById('qr-dialog')].forEach(function (dialog) {
    dialog.addEventListener('click', function (e) {
      if (e.target === dialog) dialog.close();
    });
  });

  // ---------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------
  updateGutter();
  updateCounts();
  runHighlight();
  route();
})();
