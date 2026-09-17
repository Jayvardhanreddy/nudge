(function () {
  var sidebar = document.getElementById('appSidebar');
  var backdrop = document.getElementById('sidebarBackdrop');
  var openButton = document.getElementById('sidebarOpen');
  var closeButton = document.getElementById('sidebarClose');
  var body = document.body;

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

  async function loadUser() {
    try {
      var response = await fetch('/api/me', { credentials: 'same-origin' });
      var data = await response.json().catch(function () { return {}; });
      if (!response.ok) {
        window.location.replace('login.html?tab=login');
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
  loadAccounts();
})();
