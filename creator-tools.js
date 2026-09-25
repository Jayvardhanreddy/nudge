// creator-tools.js — Comment2DM Creator Studio AI
(function () {
  'use strict';

  let aiCredits = 100;

  // ── Tab switching ──────────────────────────────────────────────────────────
  document.getElementById('studioTabs')?.addEventListener('click', (e) => {
    const tab = e.target.closest('.studio-tab');
    if (!tab) return;
    document.querySelectorAll('.studio-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.studio-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    const panel = document.getElementById('panel-' + tab.dataset.panel);
    if (panel) panel.classList.add('active');
  });

  // ── Hook count slider ──────────────────────────────────────────────────────
  const hookCountEl = document.getElementById('hookCount');
  const hookCountVal = document.getElementById('hookCountVal');
  hookCountEl?.addEventListener('input', () => { if (hookCountVal) hookCountVal.textContent = hookCountEl.value; });

  // ── DM CTA custom ─────────────────────────────────────────────────────────
  document.getElementById('dmCta')?.addEventListener('change', (e) => {
    const row = document.getElementById('customCtaRow');
    if (row) row.style.display = e.target.value === 'Custom' ? 'block' : 'none';
  });

  // ── Load AI credits ────────────────────────────────────────────────────────
  async function loadCredits() {
    try {
      const res = await fetch('/api/billing/status', { headers: window.getAuthHeaders ? window.getAuthHeaders() : {} });
      if (!res.ok) return;
      const data = await res.json();
      aiCredits = data.aiCreditsRemaining ?? data.aiCredits ?? 100;
      const el = document.getElementById('aiCreditsDisplay');
      if (el) el.textContent = aiCredits.toLocaleString();
    } catch {}
  }

  function deductCredits(amount) {
    aiCredits = Math.max(0, aiCredits - amount);
    const el = document.getElementById('aiCreditsDisplay');
    if (el) el.textContent = aiCredits.toLocaleString();
  }

  // ── Generic AI call ────────────────────────────────────────────────────────
  async function callAI(payload) {
    const res = await fetch('/api/creator/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(window.getAuthHeaders ? window.getAuthHeaders() : {}) },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Generation failed');
    return data.result;
  }

  // ── Copy helper ────────────────────────────────────────────────────────────
  function copyText(text, btn) {
    navigator.clipboard.writeText(text).then(() => {
      const orig = btn.textContent;
      btn.textContent = '✓ Copied!';
      setTimeout(() => { btn.textContent = orig; }, 2000);
    });
  }

  // ── Set button loading state ───────────────────────────────────────────────
  function setLoading(btn, loading) {
    if (loading) {
      btn.disabled = true;
      btn.innerHTML = '<div class="spinner"></div> Generating…';
    } else {
      btn.disabled = false;
      btn.textContent = btn.dataset.origText || btn.textContent;
    }
  }

  // ── Hook Generator ─────────────────────────────────────────────────────────
  const hooksBtn = document.getElementById('generateHooksBtn');
  if (hooksBtn) hooksBtn.dataset.origText = '✨ Generate Hooks';

  document.getElementById('generateHooksBtn')?.addEventListener('click', async () => {
    const topic = document.getElementById('hookTopic')?.value.trim();
    const audience = document.getElementById('hookAudience')?.value.trim();
    const tone = document.getElementById('hookTone')?.value;
    const count = parseInt(document.getElementById('hookCount')?.value || '3');
    if (!topic) { alert('Please enter a topic.'); return; }

    const btn = document.getElementById('generateHooksBtn');
    setLoading(btn, true);
    const resultEl = document.getElementById('hooksResult');
    if (resultEl) resultEl.innerHTML = '';

    try {
      const result = await callAI({ type: 'hooks', topic, audience, tone, count });
      deductCredits(10);
      const hooks = Array.isArray(result) ? result : String(result).split('\n').filter(h => h.trim());
      if (resultEl) {
        resultEl.innerHTML = hooks.map((hook, i) => `
          <div class="result-card">
            <span style="font-size:0.72rem;color:rgba(255,255,255,0.25);text-transform:uppercase;letter-spacing:0.05em;">Hook ${i + 1}</span>
            <div class="result-text" style="margin-top:4px;">${hook.replace(/^\d+\.\s*/, '')}</div>
            <button class="copy-btn" onclick="navigator.clipboard.writeText(this.closest('.result-card').querySelector('.result-text').textContent).then(()=>{this.textContent='✓ Copied!';setTimeout(()=>this.textContent='📋 Copy',2000)})">📋 Copy</button>
          </div>
        `).join('');
      }
    } catch (err) {
      if (resultEl) resultEl.innerHTML = `<div style="color:#f43f5e;font-size:0.86rem;padding:12px;">❌ ${err.message}</div>`;
    } finally {
      btn.disabled = false;
      btn.innerHTML = '✨ Generate Hooks';
    }
  });

  // ── DM Script Writer ───────────────────────────────────────────────────────
  const dmBtn = document.getElementById('generateDmBtn');
  if (dmBtn) dmBtn.dataset.origText = '✨ Generate DM Script';

  document.getElementById('generateDmBtn')?.addEventListener('click', async () => {
    const product = document.getElementById('dmProduct')?.value.trim();
    const ctaSelect = document.getElementById('dmCta')?.value;
    const cta = ctaSelect === 'Custom' ? (document.getElementById('customCta')?.value.trim() || ctaSelect) : ctaSelect;
    const tone = document.getElementById('dmTone')?.value;
    if (!product) { alert('Please enter a product/service name.'); return; }

    const btn = document.getElementById('generateDmBtn');
    setLoading(btn, true);
    const resultEl = document.getElementById('dmScriptResult');
    if (resultEl) resultEl.innerHTML = '';

    try {
      const result = await callAI({ type: 'dm_script', product, cta, tone });
      deductCredits(15);
      const script = Array.isArray(result) ? result.join('\n') : String(result);
      if (resultEl) {
        resultEl.innerHTML = `<div class="result-card">
          <div class="result-text">${script}</div>
          <button class="copy-btn" onclick="navigator.clipboard.writeText(this.closest('.result-card').querySelector('.result-text').textContent).then(()=>{this.textContent='✓ Copied!';setTimeout(()=>this.textContent='📋 Copy',2000)})">📋 Copy</button>
        </div>
        <button onclick="window.location.href='automations.html?dm=${encodeURIComponent(script)}'" style="margin-top:10px;padding:9px 16px;background:rgba(16,185,129,0.12);border:1px solid rgba(16,185,129,0.25);border-radius:10px;color:#10b981;font-size:0.84rem;font-weight:600;cursor:pointer;">⚡ Apply to Automation</button>`;
      }
    } catch (err) {
      if (resultEl) resultEl.innerHTML = `<div style="color:#f43f5e;font-size:0.86rem;padding:12px;">❌ ${err.message}</div>`;
    } finally {
      btn.disabled = false;
      btn.innerHTML = '✨ Generate DM Script';
    }
  });

  // ── Rate Calculator (client-side, no API) ──────────────────────────────────
  document.getElementById('calcRateBtn')?.addEventListener('click', () => {
    const followers = parseFloat(document.getElementById('calcFollowers')?.value) || 0;
    const likes = parseFloat(document.getElementById('calcLikes')?.value) || 0;
    const comments = parseFloat(document.getElementById('calcComments')?.value) || 0;
    if (!followers) { alert('Please enter follower count.'); return; }

    const rate = ((likes + comments) / followers) * 100;
    const rateStr = rate.toFixed(2);
    const colorClass = rate >= 3 ? 'green' : rate >= 1 ? 'yellow' : 'red';
    const label = rate >= 3 ? '🔥 Excellent' : rate >= 1 ? '👍 Average' : '⚠️ Low';

    // Industry averages by type
    const benchmarks = { nano:5.6, micro:3.8, mid:2.5, macro:1.8, mega:1.2 };
    const type = document.getElementById('calcType')?.value || 'micro';
    const benchmark = benchmarks[type] || 3;

    const estDmRate = Math.min(12, rate * 1.8).toFixed(1);
    const monthlyDms = Math.round((followers * (rate / 100)) * 0.15);
    const recKeywords = rate >= 3 ? 3 : rate >= 1 ? 5 : 8;

    const resultEl = document.getElementById('rateResult');
    if (resultEl) {
      resultEl.innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
          <div class="result-card" style="text-align:center;padding:20px;">
            <div style="font-size:0.78rem;color:rgba(255,255,255,0.35);margin-bottom:4px;">Your Engagement Rate</div>
            <div class="rate-big ${colorClass}">${rateStr}%</div>
            <div style="font-size:0.82rem;color:rgba(255,255,255,0.45);margin-top:6px;">${label}</div>
          </div>
          <div class="result-card" style="padding:20px;">
            <div style="font-size:0.78rem;color:rgba(255,255,255,0.35);margin-bottom:12px;">vs Industry Benchmark (${type})</div>
            <div style="font-size:0.8rem;color:rgba(255,255,255,0.5);display:flex;justify-content:space-between;"><span>You: ${rateStr}%</span><span>Avg: ${benchmark}%</span></div>
            <div class="benchmark-bar" style="margin-top:6px;"><div class="benchmark-fill" style="width:${Math.min(100,Math.round((rate/Math.max(rate,benchmark))*100))}%;"></div></div>
            <div style="height:4px;"></div>
            <div class="benchmark-bar"><div class="benchmark-fill" style="width:${Math.round((benchmark/Math.max(rate,benchmark))*100)}%;background:rgba(255,255,255,0.2);"></div></div>
          </div>
        </div>
        <div class="result-card" style="margin-top:14px;padding:18px;">
          <div style="font-size:0.86rem;font-weight:600;color:#f1f5f9;margin-bottom:12px;">💡 Comment2DM Recommendations</div>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;text-align:center;">
            <div><div style="font-size:1.4rem;font-weight:700;color:#818cf8;">${estDmRate}%</div><div style="font-size:0.75rem;color:rgba(255,255,255,0.35);">Est. DM open rate</div></div>
            <div><div style="font-size:1.4rem;font-weight:700;color:#10b981;">${monthlyDms.toLocaleString()}</div><div style="font-size:0.75rem;color:rgba(255,255,255,0.35);">Est. DMs/month</div></div>
            <div><div style="font-size:1.4rem;font-weight:700;color:#f59e0b;">${recKeywords}</div><div style="font-size:0.75rem;color:rgba(255,255,255,0.35);">Recommended keywords</div></div>
          </div>
          <div style="margin-top:14px;padding:10px 14px;background:rgba(99,102,241,0.08);border-radius:8px;font-size:0.82rem;color:rgba(255,255,255,0.55);">
            With your ${rateStr}% engagement rate, we recommend using <strong style="color:#818cf8;">${recKeywords} keyword triggers</strong> and targeting ${monthlyDms.toLocaleString()} DMs per month. ${rate < 1 ? 'Consider more frequent posting and engaging with comments manually to boost your rate first.' : rate < 3 ? 'You\'re doing well! Consistent posting will improve your rate further.' : 'Excellent engagement! You\'re ready to fully maximize automation with all-comments triggers.'}
          </div>
        </div>`;
    }
  });

  // ── UTM Builder ────────────────────────────────────────────────────────────
  let utmHistory = JSON.parse(localStorage.getItem('c2dm_utm_history') || '[]');

  function renderUtmHistory() {
    const list = document.getElementById('utmHistoryList');
    const historyEl = document.getElementById('utmHistory');
    if (!list || !historyEl) return;
    if (!utmHistory.length) { historyEl.style.display = 'none'; return; }
    historyEl.style.display = 'block';
    list.innerHTML = utmHistory.slice(-5).reverse().map(url => `
      <div class="utm-history-item">
        <span style="font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:80%;">${url}</span>
        <button onclick="navigator.clipboard.writeText('${url.replace(/'/g, "\\'")}').then(()=>{})" style="background:none;border:none;color:#818cf8;cursor:pointer;font-size:0.75rem;flex-shrink:0;">📋</button>
      </div>`).join('');
  }

  document.getElementById('buildUtmBtn')?.addEventListener('click', () => {
    const base = document.getElementById('utmUrl')?.value.trim();
    const campaign = document.getElementById('utmCampaign')?.value.trim().replace(/\s+/g, '-').toLowerCase();
    const medium = document.getElementById('utmMedium')?.value;
    const source = document.getElementById('utmSource')?.value;

    if (!base) { alert('Please enter a base URL.'); return; }

    const params = new URLSearchParams({ utm_source: source, utm_medium: medium, utm_campaign: campaign || 'comment2dm' });
    const fullUrl = base + (base.includes('?') ? '&' : '?') + params.toString();

    const output = document.getElementById('utmResult');
    const outputWrap = document.getElementById('utmOutput');
    if (output) output.textContent = fullUrl;
    if (outputWrap) outputWrap.style.display = 'block';

    document.getElementById('copyUtmBtn')?.addEventListener('click', () => {
      navigator.clipboard.writeText(fullUrl);
      document.getElementById('copyUtmBtn').textContent = '✓ Copied!';
      setTimeout(() => { const b = document.getElementById('copyUtmBtn'); if (b) b.textContent = '📋 Copy'; }, 2000);
    }, { once: true });

    utmHistory = [...utmHistory.filter(u => u !== fullUrl), fullUrl].slice(-5);
    localStorage.setItem('c2dm_utm_history', JSON.stringify(utmHistory));
    renderUtmHistory();
  });

  // ── Content Ideas ──────────────────────────────────────────────────────────
  const ideasBtn = document.getElementById('generateIdeasBtn');
  if (ideasBtn) ideasBtn.dataset.origText = '💡 Generate 7 Ideas';

  document.getElementById('generateIdeasBtn')?.addEventListener('click', async () => {
    const niche = document.getElementById('ideasNiche')?.value.trim();
    const week = document.getElementById('ideasWeek')?.value.trim() || 'This Week';
    if (!niche) { alert('Please enter your niche.'); return; }

    const btn = document.getElementById('generateIdeasBtn');
    setLoading(btn, true);
    const resultEl = document.getElementById('ideasResult');
    if (resultEl) resultEl.innerHTML = '';

    try {
      const result = await callAI({ type: 'ideas', niche, week });
      deductCredits(20);
      const ideas = Array.isArray(result) ? result : [];
      const formats = ['reel', 'carousel', 'story', 'static', 'reel', 'carousel', 'reel'];
      const fmtLabels = { reel:'🎬 Reel', carousel:'🎠 Carousel', story:'📱 Story', static:'🖼️ Static' };
      const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
      if (resultEl) {
        resultEl.innerHTML = ideas.map((idea, i) => {
          const fmt = formats[i] || 'reel';
          const ideaText = typeof idea === 'object' ? (idea.title || String(idea)) : String(idea);
          const hook = typeof idea === 'object' ? (idea.hook || '') : '';
          return `<div class="idea-card">
            <div class="idea-format ${fmt}">${fmtLabels[fmt]}</div>
            <div class="idea-title">${ideaText.replace(/^\d+\.\s*/, '')}</div>
            ${hook ? `<div class="idea-hook">"${hook}"</div>` : ''}
            <div class="idea-meta">📅 Best day: ${days[i]} · <a href="#" onclick="navigator.clipboard.writeText(this.closest('.idea-card').querySelector('.idea-title').textContent);return false;" style="color:#818cf8;font-size:0.72rem;">📋 Copy idea</a></div>
          </div>`;
        }).join('');
        if (!ideas.length) resultEl.innerHTML = `<div style="color:rgba(255,255,255,0.3);padding:20px;grid-column:1/-1;">No ideas returned. Try again.</div>`;
      }
    } catch (err) {
      if (resultEl) resultEl.innerHTML = `<div style="color:#f43f5e;font-size:0.86rem;padding:12px;grid-column:1/-1;">❌ ${err.message}</div>`;
    } finally {
      btn.disabled = false;
      btn.innerHTML = '💡 Generate 7 Ideas';
    }
  });

  // ── Init ──────────────────────────────────────────────────────────────────
  function init() {
    loadCredits();
    renderUtmHistory();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();