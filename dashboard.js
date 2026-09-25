// ============================================================
// Comment2DM — Dashboard & Application Shell Logic
// Apple HIG Navigation, Sidebar Collapse, Real-Time Stats
// ============================================================

(function () {
  const sidebar = document.getElementById('appSidebar');
  const sidebarToggleBtn = document.getElementById('sidebarToggleBtn');
  const collapseIcon = document.getElementById('collapseIcon');
  const mobileMenuToggle = document.getElementById('mobileMenuToggle');
  const userProfileBtn = document.getElementById('userProfileBtn');
  const userDropdownMenu = document.getElementById('userDropdownMenu');
  const logoutBtn = document.getElementById('logoutBtn');

  // Authorization helper
  window.getAuthHeaders = function (extraHeaders = {}) {
    const token = localStorage.getItem('comment2dm_token') || localStorage.getItem('nudge_token');
    const headers = { ...extraHeaders };
    if (token) {
      headers['Authorization'] = 'Bearer ' + token;
    }
    return headers;
  };

  // 1. Sidebar Collapsing Logic
  const savedCollapsed = localStorage.getItem('comment2dm_sidebar_collapsed') === 'true';
  if (savedCollapsed && sidebar) {
    sidebar.classList.add('collapsed');
    if (collapseIcon) collapseIcon.textContent = '»';
  }

  if (sidebarToggleBtn && sidebar) {
    sidebarToggleBtn.addEventListener('click', function () {
      sidebar.classList.toggle('collapsed');
      const isCollapsed = sidebar.classList.contains('collapsed');
      localStorage.setItem('comment2dm_sidebar_collapsed', isCollapsed);
      if (collapseIcon) collapseIcon.textContent = isCollapsed ? '»' : '«';
    });
  }

  // Mobile menu toggle
  if (mobileMenuToggle && sidebar) {
    mobileMenuToggle.addEventListener('click', function () {
      sidebar.classList.toggle('open');
    });
  }

  // 2. User Profile Dropdown Menu
  if (userProfileBtn && userDropdownMenu) {
    userProfileBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      userDropdownMenu.classList.toggle('show');
    });

    document.addEventListener('click', function () {
      userDropdownMenu.classList.remove('show');
    });
  }

  // 3. Logout Handler
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async function () {
      try {
        await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
      } catch (e) {}
      localStorage.removeItem('comment2dm_token');
      localStorage.removeItem('nudge_token');
      window.location.replace('login.html?tab=login');
    });
  }

  // 4. Load User Profile
  async function loadUser() {
    try {
      const response = await fetch('/api/me', {
        headers: window.getAuthHeaders(),
        credentials: 'same-origin'
      });
      if (response.status === 401) {
        localStorage.removeItem('comment2dm_token');
        window.location.replace('login.html?tab=login');
        return;
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.user) return;

      const user = data.user;
      const initial = (user.name || 'U').charAt(0).toUpperCase();

      const avatarEl = document.getElementById('userAvatarInitial');
      const nameEl = document.getElementById('topbarUserName');
      const welcomeEl = document.getElementById('welcomeGreeting');
      const dropName = document.getElementById('dropdownName');
      const dropEmail = document.getElementById('dropdownEmail');

      if (avatarEl) avatarEl.textContent = initial;
      if (nameEl) nameEl.textContent = user.name;
      if (welcomeEl) welcomeEl.textContent = `Hello, ${user.name.split(' ')[0]} 👋`;
      if (dropName) dropName.textContent = user.name;
      if (dropEmail) dropEmail.textContent = user.email;
    } catch (err) {
      console.error('Failed to load user:', err);
    }
  }

  // 5. Load Billing & Quota Limits (Updates progress bar & collapsed pie gauge)
  async function loadBillingQuota() {
    try {
      const response = await fetch('/api/billing/status', {
        headers: window.getAuthHeaders(),
        credentials: 'same-origin'
      });
      if (!response.ok) return;
      const data = await response.json().catch(() => ({}));

      const plan = String(data.plan || 'free').toLowerCase();
      const planBadge = document.getElementById('topbarPlanBadge');
      if (planBadge) {
        planBadge.textContent = plan.toUpperCase();
        planBadge.className = 'plan-badge ' + plan;
      }

      const dmMax = data.limits?.dmMonthly || 300;
      const dmUsed = data.usage?.dmMonthly || 0;
      const pct = Math.min(100, Math.round((dmUsed / dmMax) * 100));

      const limitText = document.getElementById('dmLimitText');
      const progressFill = document.getElementById('dmProgressFill');
      const pieInner = document.getElementById('pieGaugeInner');
      const pieCircle = document.getElementById('pieGaugeCircle');

      if (limitText) limitText.textContent = `${dmUsed} / ${dmMax}`;
      if (progressFill) progressFill.style.width = `${Math.max(5, pct)}%`;
      if (pieInner) pieInner.textContent = `${pct}%`;
      if (pieCircle) {
        pieCircle.style.background = `conic-gradient(var(--accent) ${pct}%, rgba(255, 255, 255, 0.1) 0)`;
      }
    } catch (e) {}
  }

  // 6. Load Connected Instagram Accounts
  async function loadInstagramAccounts() {
    try {
      const response = await fetch('/api/instagram/accounts', {
        headers: window.getAuthHeaders(),
        credentials: 'same-origin'
      });
      if (!response.ok) return;
      const data = await response.json().catch(() => ({}));
      const accounts = data.accounts || [];

      const igUsername = document.getElementById('sidebarIgUsername');
      const igStatus = document.getElementById('sidebarIgStatus');
      const igAvatar = document.getElementById('sidebarIgAvatar');
      const banner = document.getElementById('connectAccountBanner');
      const modal = document.getElementById('connectInstagramModal');

      if (accounts.length > 0) {
        const primary = accounts[0];
        if (igUsername) igUsername.textContent = '@' + primary.username;
        if (igStatus) {
          igStatus.textContent = primary.status;
          igStatus.style.color = 'var(--emerald)';
        }
        if (igAvatar) igAvatar.textContent = primary.username.charAt(0).toUpperCase();
        if (banner) banner.hidden = true;
      } else {
        if (igUsername) igUsername.textContent = 'No Account';
        if (igStatus) igStatus.textContent = 'Connect now';
        if (banner) banner.hidden = false;

        // Show modal if user hasn't dismissed it this session
        const dismissed = sessionStorage.getItem('comment2dm_ig_modal_dismissed');
        if (!dismissed && modal) {
          modal.classList.add('show');
        }
      }
    } catch (e) {}
  }

  // Dismiss modal button
  const dismissModalBtn = document.getElementById('dismissConnectModal');
  if (dismissModalBtn) {
    dismissModalBtn.addEventListener('click', function () {
      const modal = document.getElementById('connectInstagramModal');
      if (modal) modal.classList.remove('show');
      sessionStorage.setItem('comment2dm_ig_modal_dismissed', 'true');
    });
  }

  // 7. Load Home Activity & Metrics
  async function loadDashboardOverview() {
    if (document.body.getAttribute('data-page') !== 'dashboard') return;

    try {
      const response = await fetch('/api/analytics/overview', {
        headers: window.getAuthHeaders(),
        credentials: 'same-origin'
      });
      if (!response.ok) return;
      const data = await response.json().catch(() => ({}));

      const dmsSent = document.getElementById('cardDmsSent');
      const activeAutos = document.getElementById('cardActiveAutos');
      const comments = document.getElementById('cardComments');
      const deliveryRate = document.getElementById('cardDeliveryRate');
      const deliveryNote = document.getElementById('cardDeliveryNote');

      if (dmsSent) dmsSent.textContent = Number(data.messagesSent || 0).toLocaleString();
      if (activeAutos) activeAutos.textContent = Number(data.activeAutomations || 0).toLocaleString();
      if (comments) comments.textContent = Number(data.comments || 0).toLocaleString();
      if (deliveryRate) deliveryRate.textContent = (data.deliveryRate || 100) + '%';
      if (deliveryNote) deliveryNote.textContent = data.messagesFailed ? `${data.messagesFailed} failed replies` : '100% Delivery Success';

      // Render recent activity feed
      const container = document.getElementById('activityFeedContainer');
      const emptyState = document.getElementById('activityEmptyState');
      const recent = data.recent || [];

      if (container && recent.length > 0) {
        if (emptyState) emptyState.style.display = 'none';
        container.innerHTML = '';

        recent.slice(0, 8).forEach(item => {
          const row = document.createElement('div');
          row.className = 'apple-card';
          row.style.padding = '14px 18px';
          row.style.marginBottom = '10px';
          row.style.display = 'flex';
          row.style.alignItems = 'center';
          row.style.justifyContent = 'space-between';
          row.style.flexWrap = 'wrap';
          row.style.gap = '12px';

          const isSuccess = item.status === 'success';
          const icon = item.eventType === 'comment_received' ? '💬' : '📩';
          const label = item.eventType === 'comment_received' ? 'Comment detected' : 'Private DM sent';

          row.innerHTML = `
            <div style="display:flex; align-items:center; gap:12px;">
              <div style="width:36px; height:36px; border-radius:10px; background:${isSuccess ? 'var(--emerald-tint)' : 'var(--rose-tint)'}; display:flex; align-items:center; justify-content:center; font-size:1.1rem;">
                ${icon}
              </div>
              <div>
                <strong style="color:#fff; font-size:0.9rem; display:block;">${label}</strong>
                <small style="color:var(--ink-secondary); font-size:0.8rem;">Trigger: <code style="color:var(--accent-light);">${item.keyword || 'All comments'}</code></small>
              </div>
            </div>
            <div style="display:flex; align-items:center; gap:12px;">
              <span class="plan-badge ${isSuccess ? 'pro' : ''}" style="color:${isSuccess ? 'var(--emerald)' : 'var(--rose)'};">
                ${isSuccess ? '✓ Delivered' : '✗ Failed'}
              </span>
              <small style="color:var(--ink-muted); font-size:0.75rem;">${new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small>
            </div>
          `;
          container.appendChild(row);
        });
      }
    } catch (e) {}
  }

  const refreshBtn = document.getElementById('refreshActivityBtn');
  if (refreshBtn) refreshBtn.addEventListener('click', loadDashboardOverview);

  // Initialize all data
  loadUser();
  loadBillingQuota();
  loadInstagramAccounts();
  loadDashboardOverview();
})();
