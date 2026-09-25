// settings.js — Comment2DM Settings Page
(function () {
  'use strict';

  // ── Toast ──────────────────────────────────────────────────────────────────
  function showToast(msg, type = 'success') {
    const c = document.getElementById('toastContainer');
    if (!c) return;
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.textContent = msg;
    c.appendChild(t);
    requestAnimationFrame(() => { t.classList.add('show'); });
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3500);
  }

  // ── Tab switching ──────────────────────────────────────────────────────────
  document.querySelectorAll('.settings-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.settings-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      const panel = document.getElementById('panel-' + tab.dataset.panel);
      if (panel) panel.classList.add('active');
    });
  });

  // ── Password show/hide ─────────────────────────────────────────────────────
  document.querySelectorAll('.pw-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.target);
      if (!input) return;
      input.type = input.type === 'password' ? 'text' : 'password';
      btn.textContent = input.type === 'password' ? '👁' : '🙈';
    });
  });

  // ── Bio char counter ───────────────────────────────────────────────────────
  const bioField = document.getElementById('profileBio');
  const bioCount = document.getElementById('bioCount');
  if (bioField && bioCount) {
    bioField.addEventListener('input', () => { bioCount.textContent = bioField.value.length; });
  }

  // ── Avatar ─────────────────────────────────────────────────────────────────
  document.getElementById('avatarBtn')?.addEventListener('click', () => {
    document.getElementById('avatarFileInput')?.click();
  });
  document.getElementById('avatarFileInput')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const preview = document.getElementById('avatarPreview');
      if (preview) {
        preview.style.backgroundImage = `url(${ev.target.result})`;
        preview.style.backgroundSize = 'cover';
        preview.style.backgroundPosition = 'center';
        preview.textContent = '';
      }
    };
    reader.readAsDataURL(file);
  });

  // ── Load user data ─────────────────────────────────────────────────────────
  async function loadUser() {
    try {
      const res = await fetch('/api/auth/me', { headers: window.getAuthHeaders ? window.getAuthHeaders() : {} });
      if (!res.ok) return;
      const data = await res.json();
      const user = data.user || data;

      const nameEl = document.getElementById('profileName');
      const emailEl = document.getElementById('profileEmail');
      const phoneEl = document.getElementById('profilePhone');
      const bioEl = document.getElementById('profileBio');
      const avatarEl = document.getElementById('avatarPreview');

      if (nameEl) nameEl.value = user.name || '';
      if (emailEl) emailEl.value = user.email || '';
      if (phoneEl) phoneEl.value = user.phone || '';
      if (bioEl) { bioEl.value = user.bio || ''; if (bioCount) bioCount.textContent = bioEl.value.length; }
      if (avatarEl) avatarEl.textContent = (user.name || user.email || 'U')[0].toUpperCase();
    } catch (err) {
      console.error('Failed to load user:', err);
    }
  }

  // ── Load billing info ──────────────────────────────────────────────────────
  async function loadBilling() {
    try {
      const res = await fetch('/api/billing/status', { headers: window.getAuthHeaders ? window.getAuthHeaders() : {} });
      if (!res.ok) return;
      const data = await res.json();
      const plan = (data.plan || 'free');
      const planName = plan.charAt(0).toUpperCase() + plan.slice(1);
      const used = data.dmsUsed || data.dmsSent || 0;
      const limit = data.dmsLimit || 300;
      const pct = Math.min(100, Math.round((used / limit) * 100));

      const pn = document.getElementById('billingPlanName');
      const bb = document.getElementById('billingBadge');
      const bu = document.getElementById('billingDmUsage');
      const bar = document.getElementById('billingDmBar');
      if (pn) pn.textContent = planName;
      if (bb) { bb.textContent = planName; bb.className = `plan-badge ${plan}`; }
      if (bu) bu.textContent = `${used.toLocaleString()} / ${limit.toLocaleString()}`;
      if (bar) bar.style.width = pct + '%';
    } catch {}
  }

  // ── Save profile ───────────────────────────────────────────────────────────
  document.getElementById('profileForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('saveProfileBtn');
    if (btn) { btn.textContent = 'Saving…'; btn.disabled = true; }
    try {
      const body = {
        name: document.getElementById('profileName')?.value.trim(),
        phone: document.getElementById('profilePhone')?.value.trim(),
        bio: document.getElementById('profileBio')?.value.trim()
      };
      const res = await fetch('/api/settings/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...( window.getAuthHeaders ? window.getAuthHeaders() : {} ) },
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      showToast('✅ Profile saved successfully!');
    } catch (err) {
      showToast('❌ ' + err.message, 'error');
    } finally {
      if (btn) { btn.textContent = 'Save Changes'; btn.disabled = false; }
    }
  });

  // ── Change password ────────────────────────────────────────────────────────
  document.getElementById('passwordForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const current = document.getElementById('currentPw')?.value;
    const newPw = document.getElementById('newPw')?.value;
    const confirm = document.getElementById('confirmPw')?.value;
    if (newPw !== confirm) { showToast('❌ Passwords do not match', 'error'); return; }
    if (newPw.length < 8) { showToast('❌ Password must be at least 8 characters', 'error'); return; }
    try {
      const res = await fetch('/api/settings/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...( window.getAuthHeaders ? window.getAuthHeaders() : {} ) },
        body: JSON.stringify({ currentPassword: current, newPassword: newPw })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      showToast('🔒 Password updated!');
      document.getElementById('passwordForm').reset();
    } catch (err) {
      showToast('❌ ' + err.message, 'error');
    }
  });

  // ── Notifications ──────────────────────────────────────────────────────────
  function loadNotifPrefs() {
    const prefs = JSON.parse(localStorage.getItem('c2dm_notif_prefs') || '{}');
    ['dm_sent', 'failed', 'weekly', 'billing'].forEach(k => {
      const el = document.getElementById(`notif_${k}`);
      if (el && prefs[k] !== undefined) el.checked = prefs[k];
    });
  }
  document.getElementById('saveNotifBtn')?.addEventListener('click', () => {
    const prefs = {};
    ['dm_sent', 'failed', 'weekly', 'billing'].forEach(k => {
      const el = document.getElementById(`notif_${k}`);
      if (el) prefs[k] = el.checked;
    });
    localStorage.setItem('c2dm_notif_prefs', JSON.stringify(prefs));
    showToast('🔔 Notification preferences saved!');
  });

  // ── Delete account ─────────────────────────────────────────────────────────
  document.getElementById('deleteAccountBtn')?.addEventListener('click', () => {
    const modal = document.getElementById('deleteModal');
    if (modal) modal.classList.add('open');
    const inp = document.getElementById('deleteConfirmInput');
    if (inp) inp.value = '';
  });
  document.getElementById('cancelDeleteBtn')?.addEventListener('click', () => {
    document.getElementById('deleteModal')?.classList.remove('open');
  });
  document.getElementById('confirmDeleteBtn')?.addEventListener('click', async () => {
    const val = document.getElementById('deleteConfirmInput')?.value;
    if (val !== 'DELETE') { showToast('❌ Type DELETE exactly to confirm', 'error'); return; }
    try {
      const res = await fetch('/api/account/delete', {
        method: 'DELETE',
        headers: window.getAuthHeaders ? window.getAuthHeaders() : {}
      });
      if (!res.ok) throw new Error('Failed to delete');
      localStorage.clear();
      window.location.href = 'index.html';
    } catch (err) {
      showToast('❌ ' + err.message, 'error');
    }
  });

  // ── Init ──────────────────────────────────────────────────────────────────
  function init() {
    loadUser();
    loadBilling();
    loadNotifPrefs();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();