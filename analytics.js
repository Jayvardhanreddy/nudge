// analytics.js — Comment2DM Analytics Page
(function () {
  'use strict';
  let currentDays = 7;
  let refreshTimer = null;

  // ── Helpers ──────────────────────────────────────────────────────────────
  function fmt(n) {
    if (n === undefined || n === null) return '0';
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
    return String(n);
  }

  function pct(a, b) {
    if (!b || b === 0) return '0';
    return Math.round((a / b) * 100) + '';
  }

  function setText(id, val) {
    const el = document.getElementById(id);
    if (el) { el.textContent = val; el.classList.remove('loading-shimmer'); el.style.height = ''; el.style.width = ''; }
  }

  function trendHtml(val, unit) {
    if (!val && val !== 0) return '';
    const isUp = val >= 0;
    return `<span style="font-size:1rem;">${isUp ? '↑' : '↓'}</span> ${Math.abs(val)}${unit || '%'} vs prev period`;
  }

  // ── Fetch analytics data ──────────────────────────────────────────────────
  async function loadAnalytics(days) {
    try {
      const res = await fetch(`/api/analytics/overview?days=${days}`, { headers: window.getAuthHeaders ? window.getAuthHeaders() : {} });
      if (!res.ok) throw new Error('API error');
      return await res.json();
    } catch {
      // Return demo/empty data on failure
      return { dmsSent: 0, commentsProcessed: 0, activeAutomations: 0, failed: 0, dailyDms: [], automations: [] };
    }
  }

  // ── Render KPI cards ──────────────────────────────────────────────────────
  function renderKpis(data) {
    const sent = data.dmsSent || 0;
    const comments = data.commentsProcessed || 0;
    const automations = data.activeAutomations || 0;
    const deliveryRate = sent + (data.failed || 0) > 0 ? Math.round((sent / (sent + (data.failed || 0))) * 100) : 100;

    setText('kpiSent', fmt(sent));
    setText('kpiComments', fmt(comments));
    setText('kpiDelivery', deliveryRate + '%');
    setText('kpiAutomations', fmt(automations));

    const trendEl = (id, val, suffix) => {
      const el = document.getElementById(id);
      if (el) { el.innerHTML = trendHtml(val, suffix); el.className = 'kpi-trend ' + (val >= 0 ? 'up' : 'down'); }
    };
    trendEl('kpiSentTrend', data.sentTrend !== undefined ? data.sentTrend : null, '%');
    trendEl('kpiCommentsTrend', data.commentsTrend !== undefined ? data.commentsTrend : null, '%');
    trendEl('kpiDeliveryTrend', null);
    trendEl('kpiAutoTrend', null);
  }

  // ── Render bar chart ──────────────────────────────────────────────────────
  function renderChart(dailyDms) {
    const container = document.getElementById('dmTrendChart');
    if (!container) return;

    if (!dailyDms || dailyDms.length === 0) {
      // Generate placeholder zero data for last N days
      const n = currentDays <= 7 ? 7 : currentDays <= 30 ? 30 : 14;
      dailyDms = Array.from({ length: n }, (_, i) => {
        const d = new Date(); d.setDate(d.getDate() - (n - 1 - i));
        return { date: d.toISOString().slice(5, 10), count: 0 };
      });
    }

    // Limit bars based on days
    let bars = dailyDms;
    if (currentDays === 7 && bars.length > 7) bars = bars.slice(-7);
    if (currentDays === 30 && bars.length > 30) bars = bars.slice(-30);
    if (currentDays === 90 && bars.length > 90) bars = bars.slice(-90);

    const maxVal = Math.max(...bars.map(b => b.count || 0), 1);

    container.innerHTML = bars.map(b => {
      const h = Math.max(4, Math.round(((b.count || 0) / maxVal) * 140));
      const label = bars.length <= 14 ? (b.date || '').slice(3) : '';
      return `<div class="chart-bar-wrap" title="${b.date}: ${b.count || 0} DMs">
        <div class="chart-bar" style="height:${h}px;" title="${b.count || 0}"></div>
        ${label ? `<div class="chart-bar-label">${label}</div>` : ''}
      </div>`;
    }).join('');
  }

  // ── Render funnel ─────────────────────────────────────────────────────────
  function renderFunnel(data) {
    const comments = data.commentsProcessed || 0;
    const triggered = data.dmsSent + (data.failed || 0);
    const delivered = data.dmsSent || 0;

    setText('funnelComments', fmt(comments));
    setText('funnelTriggered', fmt(triggered));
    setText('funnelDelivered', fmt(delivered));

    const el1 = document.getElementById('funnelPct1');
    const el2 = document.getElementById('funnelPct2');
    if (el1) el1.textContent = pct(triggered, comments) + '%';
    if (el2) el2.textContent = pct(delivered, triggered) + '%';
  }

  // ── Render leaderboard ────────────────────────────────────────────────────
  function renderLeaderboard(automations) {
    const tbody = document.getElementById('leaderboardBody');
    if (!tbody) return;

    if (!automations || automations.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6">
        <div class="empty-state"><div class="empty-state-icon">🤖</div>
        <p style="font-size:0.9rem;">No automations yet. <a href="automations.html" style="color:#818cf8;">Create your first →</a></p></div>
      </td></tr>`;
      return;
    }

    tbody.innerHTML = automations.map((a, i) => {
      const successRate = a.total > 0 ? Math.round((a.sent / a.total) * 100) : 100;
      const badge = a.active !== false
        ? `<span class="status-badge active">● Active</span>`
        : `<span class="status-badge paused">● Paused</span>`;
      const bar = `<div style="display:flex;align-items:center;gap:8px;">
        <div style="flex:1;height:4px;background:rgba(255,255,255,0.08);border-radius:2px;overflow:hidden;">
          <div style="width:${successRate}%;height:100%;background:linear-gradient(90deg,#6366f1,#10b981);border-radius:2px;"></div>
        </div>
        <span style="font-size:0.8rem;color:#e2e8f0;min-width:36px;">${successRate}%</span>
      </div>`;
      return `<tr>
        <td style="color:rgba(255,255,255,0.35);font-size:0.8rem;">${i + 1}</td>
        <td><span style="font-weight:500;">⚡ ${a.name || 'Automation ' + (i + 1)}</span></td>
        <td style="color:rgba(255,255,255,0.5);">@${a.account || '–'}</td>
        <td style="font-weight:600;">${fmt(a.sent || 0)}</td>
        <td style="min-width:120px;">${bar}</td>
        <td>${badge}</td>
      </tr>`;
    }).join('');
  }

  // ── Main render ───────────────────────────────────────────────────────────
  async function render() {
    const data = await loadAnalytics(currentDays);
    renderKpis(data);
    renderChart(data.dailyDms || []);
    renderFunnel(data);
    renderLeaderboard(data.automations || []);
  }

  // ── Date range tabs ───────────────────────────────────────────────────────
  document.getElementById('rangeTabs')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.range-tab');
    if (!btn) return;
    document.querySelectorAll('.range-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentDays = parseInt(btn.dataset.days, 10);
    render();
  });

  document.getElementById('refreshBtn')?.addEventListener('click', render);

  // ── Auto-refresh every 60 seconds ────────────────────────────────────────
  function startAutoRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(render, 60000);
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    render();
    startAutoRefresh();
  });

  // Kick off immediately too (dashboard.js may have already fired DOMContentLoaded)
  if (document.readyState !== 'loading') {
    render();
    startAutoRefresh();
  }
})();