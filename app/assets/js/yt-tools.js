/* Shared helpers for the YouTube automation tool pages (R4).
 * Each page includes this file, then a small inline script that wires its
 * own form to one /api/youtube/* endpoint. Auth follows the app convention:
 * token in localStorage 'veo_token', API base override in 'veo_api_base'. */
(function (global) {
  'use strict';

  function apiBase() { return (localStorage.getItem('veo_api_base') || '').replace(/\/$/, ''); }
  function token() { return localStorage.getItem('veo_token') || ''; }
  function headers() {
    var h = { 'Content-Type': 'application/json' };
    var t = token();
    if (t) h['Authorization'] = 'Bearer ' + t;
    return h;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmt(n) {
    n = Number(n || 0);
    if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return String(n);
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    return isNaN(d) ? '—' : d.toLocaleDateString();
  }

  /** Minimal markdown → HTML for LLM-generated SEO/tags/prompt output. */
  function markdown(src) {
    var lines = String(src || '').split('\n');
    var html = '';
    var inList = false;
    function closeList() { if (inList) { html += '</ul>'; inList = false; } }
    lines.forEach(function (line) {
      var t = line.trim();
      var h = /^(#{1,3})\s+(.*)/.exec(t) || /^([A-Z][A-Z0-9 /&-]{2,}):\s*$/.exec(t);
      if (/^([A-Z][A-Z0-9 /&-]{2,}):\s*$/.test(t)) {
        closeList();
        html += '<h4 class="md-h">' + esc(t.replace(/:$/, '')) + '</h4>';
        return;
      }
      if (h && h[1]) {
        closeList();
        html += '<h4 class="md-h">' + esc(h[2]) + '</h4>';
        return;
      }
      var li = /^[-*]\s+(.*)/.exec(t) || /^\d+[.)]\s+(.*)/.exec(t);
      if (li) {
        if (!inList) { html += '<ul class="md-list">'; inList = true; }
        html += '<li>' + inline(li[1]) + '</li>';
        return;
      }
      closeList();
      if (!t) return;
      html += '<p class="md-p">' + inline(t) + '</p>';
    });
    closeList();
    return html;
  }

  function inline(s) {
    return esc(s)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
  }

  function errHtml(j, status) {
    var msg = (j && (j.message || j.error)) || 'Request failed';
    if (status === 503 && j && (j.error === 'youtube_not_configured' || j.error === 'llm_not_configured')) {
      return '<div class="card"><p><strong>Setup needed.</strong> ' + esc(msg) + '</p>'
        + '<p><a class="btn btn-primary btn-sm" href="/api-keys">Open API Keys</a></p></div>';
    }
    if (status === 429) return '<div class="card"><p><strong>Daily quota reached.</strong> Try again tomorrow.</p></div>';
    if (status === 401) return '<div class="card"><p><strong>Not logged in.</strong> Log in again to use this tool.</p></div>';
    return '<div class="card"><p><strong>Something went wrong.</strong> ' + esc(msg) + '</p></div>';
  }

  function cachedBadge(cached) {
    return cached ? ' <span class="api-auth-badge">cached</span>' : '';
  }

  /** Wire a form to an endpoint. opts: { form, btn, body(), render(j), loadingText } */
  function wire(opts) {
    var form = typeof opts.form === 'string' ? document.querySelector(opts.form) : opts.form;
    var resultEl = typeof opts.result === 'string' ? document.querySelector(opts.result) : opts.result;
    if (!form || !resultEl) return;
    form.removeAttribute('data-demo');
    var btn = form.querySelector('button.btn-primary');
    if (btn) btn.removeAttribute('disabled');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var body = opts.body();
      if (body === null) return;
      if (btn) { btn.disabled = true; btn.dataset.label = btn.textContent; btn.textContent = opts.loadingText || 'Working…'; }
      resultEl.innerHTML = '<div class="card"><p class="text-muted">Working…</p></div>';
      fetch(apiBase() + opts.endpoint, { method: 'POST', headers: headers(), body: JSON.stringify(body) })
        .then(function (r) { return r.json().then(function (j) { return { status: r.status, ok: r.ok, j: j }; }); })
        .then(function (res) {
          if (btn) { btn.disabled = false; btn.textContent = btn.dataset.label || btn.textContent; }
          if (!res.ok) { resultEl.innerHTML = errHtml(res.j, res.status); return; }
          resultEl.innerHTML = opts.render(res.j);
        })
        .catch(function (err) {
          if (btn) { btn.disabled = false; btn.textContent = btn.dataset.label || btn.textContent; }
          resultEl.innerHTML = '<div class="card"><p><strong>Could not reach the API.</strong> ' + esc(err.message) + '</p></div>';
        });
    });
  }

  function videoRow(v) {    return '<div class="yt-row"><div class="yt-row-main"><a href="https://youtube.com/watch?v=' + esc(v.id) + '" target="_blank" rel="noopener">' + esc(v.title) + '</a>'
      + '<div class="text-muted text-sm">' + esc(v.channel || '') + ' · ' + fmtDate(v.published_at) + '</div></div>'
      + '<div class="yt-row-stats"><span>' + fmt(v.views) + ' views</span><span>' + fmt(v.likes) + ' likes</span></div></div>';
  }

  function statCard(label, value) {
    return '<div class="yt-stat"><div class="v">' + esc(value) + '</div><div class="l">' + esc(label) + '</div></div>';
  }

  global.Yt = {
    apiBase: apiBase, token: token, headers: headers,
    esc: esc, fmt: fmt, fmtDate: fmtDate, markdown: markdown,
    errHtml: errHtml, cachedBadge: cachedBadge, wire: wire, videoRow: videoRow, statCard: statCard
  };
})(window);
