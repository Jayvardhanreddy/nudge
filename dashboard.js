(function () {
  var sidebar = document.getElementById('appSidebar');
  var backdrop = document.getElementById('sidebarBackdrop');
  var openButton = document.getElementById('sidebarOpen');
  var closeButton = document.getElementById('sidebarClose');
  var body = document.body;

  var userAccounts = [];

  function closeSidebar() {
    if (!sidebar) return;
    sidebar.classList.remove('open');
    if (backdrop) backdrop.classList.remove('show');
  }

  if (openButton) openButton.addEventListener('click', function () {
    sidebar.classList.add('open');
    backdrop.classList.add('show');
  });
  if (closeButton) closeButton.addEventListener('click', closeSidebar);
  if (backdrop) backdrop.addEventListener('click', closeSidebar);
  document.querySelectorAll('.app-nav a').forEach(function (link) {
    if (link.getAttribute('data-nav') === body.getAttribute('data-page')) link.classList.add('active');
    link.addEventListener('click', closeSidebar);
  });

  function showError(message) {
    var errorBox = document.getElementById('dashboardError');
    if (!errorBox) return;
    errorBox.textContent = message;
    errorBox.classList.add('show');
  }

  function hideError() {
    var errorBox = document.getElementById('dashboardError');
    if (errorBox) {
      errorBox.textContent = '';
      errorBox.classList.remove('show');
    }
  }

  function showNotice(message) {
    var noticeBox = document.getElementById('automationNotice');
    if (!noticeBox) return;
    noticeBox.textContent = message;
    noticeBox.hidden = false;
    setTimeout(function () { noticeBox.hidden = true; }, 4000);
  }

  async function loadDashboardOverview() {
    if (document.body.getAttribute('data-page') !== 'dashboard') return;
    try {
      var response = await fetch('/api/analytics/overview', { credentials: 'same-origin' });
      var data = await response.json().catch(function(){ return {}; });
      if (!response.ok) return;
      var cards = document.querySelectorAll('.overview-card strong');
      if (cards[0]) cards[0].textContent = data.accounts;
      if (cards[1]) cards[1].textContent = data.activeAutomations;
      if (cards[2]) cards[2].textContent = data.messagesSent;
      if (cards[3]) cards[3].textContent = data.comments;
      var notes = document.querySelectorAll('.overview-card .overview-note');
      if (notes[0]) notes[0].textContent = data.accounts === 1 ? '1 account connected' : data.accounts + ' accounts connected';
      if (notes[1]) notes[1].textContent = data.activeAutomations === 1 ? '1 automation active' : data.activeAutomations + ' automations active';
      if (notes[2]) notes[2].textContent = data.messagesFailed ? data.messagesFailed + ' failed replies' : 'No failed replies';
      if (notes[3]) notes[3].textContent = data.comments ? 'Live webhook activity tracked' : 'No activity yet';
    } catch (e) {}
  }

  async function loadUser() {
    try {
      var response = await fetch('/api/me', { credentials: 'same-origin' });
      var data = await response.json().catch(function () { return {}; });
      if (response.status === 401) {
        window.location.replace('login.html?tab=login');
        return;
      }
      if (!response.ok) {
        showError(data.error || 'Unable to verify your session right now. Please try again.');
        return;
      }
      var userName = document.getElementById('userName');
      var userEmail = document.getElementById('userEmail');
      var welcomeHeading = document.getElementById('welcomeHeading');
      if (userName) userName.textContent = data.user.name;
      if (userEmail) userEmail.textContent = data.user.email;
      if (welcomeHeading) welcomeHeading.textContent = 'Welcome back, ' + data.user.name;
    } catch (error) {
      showError('Unable to verify your session. Please refresh or sign in again.');
    }
  }

  function renderAccounts(accounts) {
    var container = document.getElementById('instagramAccounts');
    var emptyState = document.getElementById('instagramEmpty');
    if (!container || !emptyState) return;
    container.innerHTML = '';
    emptyState.hidden = accounts.length !== 0;
    accounts.forEach(function (account) {
      var card = document.createElement('div');
      card.className = 'instagram-account-card';
      card.innerHTML =
        '<div class="account-avatar">i</div>' +
        '<div class="account-info"><strong></strong><span></span><small></small></div>' +
        '<button class="btn btn-ghost disconnect-account">Disconnect</button>';
      card.querySelector('strong').textContent = '@' + account.username;
      card.querySelector('span').textContent = 'Instagram account';
      card.querySelector('small').textContent = account.status;
      card.querySelector('.disconnect-account').addEventListener('click', async function () {
        var response = await fetch('/api/instagram/accounts/' + encodeURIComponent(account.id), {
          method: 'DELETE',
          credentials: 'same-origin'
        });
        if (!response.ok) {
          showError('Unable to disconnect this Instagram account.');
          return;
        }
        loadAccounts();
      });
      container.appendChild(card);
    });
  }

  async function loadAccounts() {
    var container = document.getElementById('instagramAccounts');
    if (!container) return;
    try {
      var response = await fetch('/api/instagram/accounts', { credentials: 'same-origin' });
      var data = await response.json().catch(function () { return {}; });
      if (!response.ok) {
        if (response.status === 401) window.location.replace('login.html?tab=login');
        else showError(data.error || 'Unable to load Instagram accounts.');
        return;
      }
      renderAccounts(data.accounts || []);
    } catch (error) {
      showError('Unable to load Instagram accounts.');
    }
  }

  // Automations Page Logic
  function openAutomationForm(automationToEdit) {
    hideError();
    var formCard = document.getElementById('automationFormCard');
    var heading = document.getElementById('automationFormHeading');
    var idInput = document.getElementById('automationId');
    var select = document.getElementById('automationAccountSelect');
    var keywordInput = document.getElementById('automationKeywordInput');
    var messageInput = document.getElementById('automationDmMessageInput');
    var enabledCheckbox = document.getElementById('automationEnabledCheckbox');

    if (!formCard || !select) return;

    select.innerHTML = '';
    userAccounts.forEach(function (acc) {
      var opt = document.createElement('option');
      opt.value = acc.id;
      opt.textContent = '@' + acc.username;
      select.appendChild(opt);
    });

    if (automationToEdit) {
      heading.textContent = 'Edit Automation';
      idInput.value = automationToEdit.id;
      select.value = automationToEdit.instagramUserId;
      keywordInput.value = automationToEdit.keyword;
      messageInput.value = automationToEdit.dmMessage;
      enabledCheckbox.checked = automationToEdit.enabled === 1;
    } else {
      heading.textContent = 'Create Automation';
      idInput.value = '';
      if (userAccounts.length > 0) select.value = userAccounts[0].id;
      keywordInput.value = '';
      messageInput.value = '';
      enabledCheckbox.checked = true;
    }

    formCard.hidden = false;
    formCard.scrollIntoView({ behavior: 'smooth' });
  }

  function closeAutomationForm() {
    var formCard = document.getElementById('automationFormCard');
    if (formCard) formCard.hidden = true;
  }

  function renderAutomations(automations) {
    var container = document.getElementById('automationsList');
    var emptyState = document.getElementById('automationsEmpty');
    var openBtn = document.getElementById('openCreateAutomation');
    var noAccountWarn = document.getElementById('noAccountWarning');

    if (!container) return;

    if (userAccounts.length === 0) {
      if (noAccountWarn) noAccountWarn.hidden = false;
      if (openBtn) openBtn.hidden = true;
      if (emptyState) emptyState.hidden = true;
      container.innerHTML = '';
      return;
    }

    if (noAccountWarn) noAccountWarn.hidden = true;
    if (openBtn) openBtn.hidden = false;

    container.innerHTML = '';

    if (automations.length === 0) {
      if (emptyState) emptyState.hidden = false;
      return;
    }

    if (emptyState) emptyState.hidden = true;

    automations.forEach(function (item) {
      var card = document.createElement('div');
      card.className = 'instagram-account-card';
      card.innerHTML =
        '<div class="account-avatar" style="background:var(--accent-tint); color:var(--accent); font-size:1.1rem;">a</div>' +
        '<div class="account-info">' +
          '<strong></strong>' +
          '<span style="margin-top:2px;">Keyword: <code style="background:var(--bg); padding:2px 7px; border-radius:4px; font-weight:600; font-family:monospace; color:var(--ink);"></code></span>' +
          '<span style="margin-top:4px; font-size:0.85rem; color:var(--ink-soft);">DM Message: "<span class="msg-text"></span>"</span>' +
          '<small style="margin-top:6px;"></small>' +
        '</div>' +
        '<div class="card-actions" style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">' +
          '<button class="btn btn-ghost toggle-btn" style="padding:7px 12px; font-size:0.8rem;"></button>' +
          '<button class="btn btn-ghost edit-btn" style="padding:7px 12px; font-size:0.8rem;">Edit</button>' +
          '<button class="btn btn-ghost delete-btn" style="padding:7px 12px; font-size:0.8rem; color:#B4123C; border-color:#FFBAC6;">Delete</button>' +
        '</div>';

      var accountName = item.username ? '@' + item.username : 'Account ' + item.instagramUserId;
      card.querySelector('strong').textContent = accountName;
      card.querySelector('code').textContent = item.keyword;
      card.querySelector('.msg-text').textContent = item.dmMessage;

      var statusSmall = card.querySelector('small');
      var toggleBtn = card.querySelector('.toggle-btn');
      if (item.enabled) {
        statusSmall.textContent = 'Active';
        statusSmall.style.color = 'var(--teal)';
        toggleBtn.textContent = 'Disable';
      } else {
        statusSmall.textContent = 'Disabled';
        statusSmall.style.color = 'var(--ink-soft)';
        toggleBtn.textContent = 'Enable';
      }

      toggleBtn.addEventListener('click', async function () {
        toggleBtn.disabled = true;
        try {
          var response = await fetch('/api/automations/' + item.id, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ enabled: !item.enabled })
          });
          var data = await response.json().catch(function () { return {}; });
          if (!response.ok) {
            showError(data.error || 'Failed to update automation status.');
            return;
          }
          loadAutomationsPage();
        } catch (err) {
          showError('Unable to update automation.');
        } finally {
          toggleBtn.disabled = false;
        }
      });

      card.querySelector('.edit-btn').addEventListener('click', function () {
        openAutomationForm(item);
      });

      card.querySelector('.delete-btn').addEventListener('click', async function () {
        if (!confirm('Are you sure you want to delete this automation?')) return;
        try {
          var response = await fetch('/api/automations/' + item.id, {
            method: 'DELETE',
            credentials: 'same-origin'
          });
          if (!response.ok) {
            var data = await response.json().catch(function () { return {}; });
            showError(data.error || 'Failed to delete automation.');
            return;
          }
          showNotice('Automation deleted.');
          loadAutomationsPage();
        } catch (err) {
          showError('Unable to delete automation.');
        }
      });

      container.appendChild(card);
    });
  }

  async function loadAutomationsPage() {
    var container = document.getElementById('automationsList');
    if (!container) return;

    try {
      var accRes = await fetch('/api/instagram/accounts', { credentials: 'same-origin' });
      var accData = await accRes.json().catch(function () { return {}; });
      if (!accRes.ok) {
        if (accRes.status === 401) window.location.replace('login.html?tab=login');
        else showError(accData.error || 'Unable to load Instagram accounts.');
        return;
      }
      userAccounts = accData.accounts || [];

      if (userAccounts.length === 0) {
        renderAutomations([]);
        return;
      }

      var autoRes = await fetch('/api/automations', { credentials: 'same-origin' });
      var autoData = await autoRes.json().catch(function () { return {}; });
      if (!autoRes.ok) {
        showError(autoData.error || 'Unable to load automations.');
        return;
      }
      renderAutomations(autoData.automations || []);
    } catch (err) {
      showError('Unable to load automations.');
    }
  }

  var openCreateBtn = document.getElementById('openCreateAutomation');
  var createFirstBtn = document.getElementById('createFirstAutomation');
  var cancelBtn = document.getElementById('cancelAutomationBtn');
  var automationForm = document.getElementById('automationForm');

  if (openCreateBtn) openCreateBtn.addEventListener('click', function () { openAutomationForm(null); });
  if (createFirstBtn) createFirstBtn.addEventListener('click', function () { openAutomationForm(null); });
  if (cancelBtn) cancelBtn.addEventListener('click', closeAutomationForm);

  if (automationForm) {
    automationForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      hideError();

      var id = document.getElementById('automationId').value;
      var instagramUserId = document.getElementById('automationAccountSelect').value;
      var keyword = document.getElementById('automationKeywordInput').value.trim();
      var dmMessage = document.getElementById('automationDmMessageInput').value.trim();
      var enabled = document.getElementById('automationEnabledCheckbox').checked;
      var saveBtn = document.getElementById('saveAutomationBtn');

      if (!instagramUserId) {
        showError('Please select an Instagram account.');
        return;
      }
      if (!keyword) {
        showError('Keyword cannot be empty.');
        return;
      }
      if (!dmMessage) {
        showError('DM Message cannot be empty.');
        return;
      }

      saveBtn.disabled = true;
      try {
        var url = id ? '/api/automations/' + encodeURIComponent(id) : '/api/automations';
        var method = id ? 'PATCH' : 'POST';

        var response = await fetch(url, {
          method: method,
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ instagramUserId: instagramUserId, keyword: keyword, dmMessage: dmMessage, enabled: enabled })
        });

        var data = await response.json().catch(function () { return {}; });

        if (!response.ok) {
          showError(data.error || 'Failed to save automation.');
          return;
        }

        closeAutomationForm();
        showNotice(id ? 'Automation updated successfully.' : 'Automation created successfully.');
        loadAutomationsPage();
      } catch (err) {
        showError('Unable to save automation.');
      } finally {
        saveBtn.disabled = false;
      }
    });
  }

  var connectButton = document.getElementById('connectInstagram');
  if (connectButton) connectButton.addEventListener('click', function () {
    window.location.href = '/api/instagram/authorize';
  });

  var logoutButton = document.getElementById('logoutButton');
  if (logoutButton) logoutButton.addEventListener('click', async function () {
    logoutButton.disabled = true;
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    } finally {
      window.location.replace('login.html?tab=login');
    }
  });

  var query = new URLSearchParams(window.location.search);
  if (query.get('instagram_error')) showError(query.get('instagram_error'));
  if (query.get('instagram_connected') === '1') {
    var connectedNotice = document.getElementById('connectionNotice');
    if (connectedNotice) connectedNotice.hidden = false;
  }
  loadUser();
  loadDashboardOverview();
  loadAccounts();
  loadAutomationsPage();
})();
