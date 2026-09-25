// messages.js — Comment2DM DM Activity Log
(function () {
  'use strict';
  let page = 1;
  let totalPages = 1;
  let pollTimer = null;
  let currentFilters = { status: 'all', days: '7', search: '' };

  // ── Relative time ──────────────────────────────────────────────────────────
  function relativeTime(dateStr) {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '–';
    const diff = Math.floor((Date.now() - d.getTime()) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + ' min ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    if (diff < 604800) return Math.floor(diff / 86400) + 'd ago';
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  }

  function trunc(str, max) {
    if (!str) return '–';
    return str.length > max ? str.slice(0, max) + '…' : str;
  }

  function initials(name) {
    if (!name) return '?';
    return name.split(/[\s_.]/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  }

  // ── Fetch events ──────────────────────────────────────────────────────────
  async function fetchEvents() {
    const params = new URLSearchParams({
      page: String(page),
      limit: '20',
      status: currentFilters.status,
      days: currentFilters.days,
      search: currentFilters.search
    });
    try {
      const res = await fetch(`/api/analytics/events?${params}`, { headers: window.getAuthHeaders ? window.getAuthHeaders() : {} });
      if (!res.ok) throw new Error('API error');
      return await res.json();
    } catch {
      return { events: [], total: 0, sent: 0, failed: 0, pending: 0, pages: 1 };
    }
  }

  // ── Render table ──────────────────────────────────────────────────────────
  function renderTable(data) {
    const tbody = document.getElementById('dmTableBody');
    if (!tbody) return;

    // Stats
    const setS = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v ?? '0'; };
    setS('statTotal', data.total ?? 0);
    setS('statSent', data.sent ?? 0);
    setS('statFailed', data.failed ?? 0);
    setS('statPending', data.pending ?? 0);

    // Pagination
    totalPages = data.pages || 1;
    const pi = document.getElementById('pageInfo');
    if (pi) pi.textContent = `Page ${page} of ${totalPages}`;
    const prev = document.getElementById('prevBtn');
    const next = document.getElementById('nextBtn');
    if (prev) prev.disabled = page <= 1;
    if (next) next.disabled = page >= totalPages;

    const events = data.events || [];
    if (events.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6">
        <div style="text-align:center;padding:50px;color:rgba(255,255,255,0.3);">
          <div style="font-size:2.5rem;margin-bottom:12px;">💌</div>
          <p style="font-size:0.9rem;">No DM activity yet.</p>
          <p style="font-size:0.8rem;margin-top:6px;"><a href="automations.html" style="color:#818cf8;">Create an automation →</a></p>
        </div>
      </td></tr>`;
      return;
    }

    tbody.innerHTML = events.map(ev => {
      const handle = ev.senderName || ev.username || 'Unknown';
      const statusClass = ev.status === 'sent' ? 'sent' : ev.status === 'failed' ? 'failed' : 'pending';
      const statusLabel = ev.status === 'sent' ? '✅ Sent' : ev.status === 'failed' ? '❌ Failed' : '⏳ Pending';
      const statusColor = ev.status === 'sent' ? '#10b981' : ev.status === 'failed' ? '#f43f5e' : '#f59e0b';
      return `<tr>
        <td style="padding-left:20px;">
          <div class="handle-cell">
            <div class="avatar-circle">${initials(handle)}</div>
            <span style="font-weight:500;">@${handle}</span>
          </div>
        </td>
        <td><span class="preview-text" title="${ev.commentText || ''}">${trunc(ev.commentText, 55)}</span></td>
        <td><span class="preview-text" title="${ev.dmText || ''}">${trunc(ev.dmText, 55)}</span></td>
        <td>${ev.automationName ? `<span class="automation-pill">⚡ ${trunc(ev.automationName, 24)}</span>` : '–'}</td>
        <td>
          <div class="status-cell">
            <span class="status-dot ${statusClass}"></span>
            <span style="color:${statusColor};">${statusLabel}</span>
          </div>
        </td>
        <td style="color:rgba(255,255,255,0.4);white-space:nowrap;">${relativeTime(ev.createdAt || ev.created_at)}</td>
      </tr>`;
    }).join('');
  }

  // ── Load + render ─────────────────────────────────────────────────────────
  async function load() {
    const tbody = document.getElementById('dmTableBody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:30px;color:rgba(255,255,255,0.3);">Loading…</td></tr>`;
    const data = await fetchEvents();
    renderTable(data);
  }

  // ── Debounce search ───────────────────────────────────────────────────────
  let searchDebounce;
  document.getElementById('searchInput')?.addEventListener('input', (e) => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      currentFilters.search = e.target.value.trim();
      page = 1;
      load();
    }, 350);
  });

  document.getElementById('statusFilter')?.addEventListener('change', (e) => {
    currentFilters.status = e.target.value;
    page = 1;
    load();
  });

  document.getElementById('daysFilter')?.addEventListener('change', (e) => {
    currentFilters.days = e.target.value;
    page = 1;
    load();
  });

  document.getElementById('prevBtn')?.addEventListener('click', () => {
    if (page > 1) { page--; load(); }
  });

  document.getElementById('nextBtn')?.addEventListener('click', () => {
    if (page < totalPages) { page++; load(); }
  });

  // ── Auto-poll every 30s ───────────────────────────────────────────────────
  function startPoll() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => { if (page === 1) load(); }, 30000);
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  function init() { load(); startPoll(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
