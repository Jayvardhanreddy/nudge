// ============================================================
// Comment2DM — Client Core Script
// Persistent Auth, UI Toggles & Form Handlers
// ============================================================

(function () {
  // Helper: get authorization headers including fallback localStorage token
  window.getAuthHeaders = function (extraHeaders = {}) {
    const token = localStorage.getItem('comment2dm_token') || localStorage.getItem('nudge_token');
    const headers = { ...extraHeaders };
    if (token) {
      headers['Authorization'] = 'Bearer ' + token;
    }
    return headers;
  };

  // Helper: check session and redirect if already authenticated
  async function checkSession() {
    try {
      const response = await fetch('/api/me', {
        headers: window.getAuthHeaders(),
        credentials: 'same-origin'
      });
      if (response.ok) {
        const data = await response.json().catch(() => ({}));
        if (data.user) {
          // If on login page, redirect to dashboard
          if (window.location.pathname.endsWith('login.html')) {
            window.location.replace('dashboard.html');
            return;
          }
          // If on landing page, update header actions
          const headerActions = document.querySelector('.header-actions');
          if (headerActions) {
            headerActions.innerHTML = '<a href="dashboard.html" class="btn btn-ghost">Dashboard</a><a href="settings.html" class="btn btn-primary">Account</a>';
          }
        }
      } else {
        // If unauthenticated on a protected app page, redirect to login
        if (document.body.classList.contains('app-body') && 
            !window.location.pathname.endsWith('login.html') && 
            !window.location.pathname.endsWith('index.html') &&
            !window.location.pathname.endsWith('pricing.html') &&
            !window.location.pathname.endsWith('privacy.html') &&
            !window.location.pathname.endsWith('terms.html') &&
            !window.location.pathname.endsWith('refund.html') &&
            !window.location.pathname.endsWith('contact.html') &&
            !window.location.pathname.endsWith('404.html')) {
          localStorage.removeItem('comment2dm_token');
          window.location.replace('login.html?tab=login');
        }
      }
    } catch (e) {}
  }

  checkSession();

  // Mobile navigation drawer toggle for public landing pages
  const navToggle = document.getElementById('navToggle');
  const siteHeader = document.querySelector('.site-header');
  if (navToggle && siteHeader) {
    navToggle.addEventListener('click', function () {
      siteHeader.classList.toggle('nav-open');
    });
  }

  // Auth Tabs on login.html
  window.switchAuthTab = function (tab) {
    const isLogin = tab === 'login';
    const loginForm = document.getElementById('loginForm');
    const signupForm = document.getElementById('signupForm');
    const subtitle = document.getElementById('authSubtitle');
    const tabs = document.querySelectorAll('.auth-tab-btn');
    const errorBox = document.getElementById('formError');

    if (errorBox) errorBox.classList.remove('show');

    if (loginForm && signupForm) {
      loginForm.style.display = isLogin ? 'block' : 'none';
      signupForm.style.display = isLogin ? 'none' : 'block';
    }

    if (subtitle) {
      subtitle.textContent = isLogin ? 'Log in to manage your automations' : 'Create your free account in 30 seconds';
    }

    tabs.forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === tab);
    });

    const url = new URL(window.location);
    url.searchParams.set('tab', tab);
    window.history.replaceState({}, '', url);
  };

  const authTabsContainer = document.getElementById('authTabs');
  if (authTabsContainer) {
    authTabsContainer.addEventListener('click', function (e) {
      const btn = e.target.closest('.auth-tab-btn');
      if (btn) switchAuthTab(btn.getAttribute('data-tab'));
    });

    const params = new URLSearchParams(window.location.search);
    if (params.get('tab') === 'signup') {
      switchAuthTab('signup');
    }
    if (params.get('auth_error')) {
      const errorBox = document.getElementById('formError');
      if (errorBox) {
        errorBox.textContent = params.get('auth_error');
        errorBox.classList.add('show');
      }
    }
  }

  function showAuthError(msg) {
    const errorBox = document.getElementById('formError');
    if (errorBox) {
      errorBox.textContent = msg;
      errorBox.classList.add('show');
    }
  }

  // Handle Login submission
  const loginForm = document.getElementById('loginForm');
  if (loginForm) {
    loginForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      const email = document.getElementById('loginEmail').value.trim();
      const password = document.getElementById('loginPassword').value;
      const submitBtn = document.getElementById('loginSubmitBtn');

      if (!email || !password) {
        showAuthError('Please enter your email and password.');
        return;
      }

      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span>Signing in…</span>';

      try {
        const response = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ email, password })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          showAuthError(data.error || 'Invalid email or password.');
          submitBtn.disabled = false;
          submitBtn.innerHTML = '<span>Log in to Comment2DM</span>';
          return;
        }

        if (data.sessionToken) {
          localStorage.setItem('comment2dm_token', data.sessionToken);
        }

        window.location.replace('dashboard.html');
      } catch (err) {
        showAuthError('Unable to sign in right now. Please try again.');
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<span>Log in to Comment2DM</span>';
      }
    });
  }

  // Handle Signup submission
  const signupForm = document.getElementById('signupForm');
  if (signupForm) {
    signupForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      const name = document.getElementById('signupName').value.trim();
      const email = document.getElementById('signupEmail').value.trim();
      const password = document.getElementById('signupPassword').value;
      const terms = document.getElementById('signupTerms').checked;
      const submitBtn = document.getElementById('signupSubmitBtn');

      if (!name || name.length < 2) {
        showAuthError('Please enter your full name.');
        return;
      }
      if (!email) {
        showAuthError('Please enter a valid email address.');
        return;
      }
      if (!password || password.length < 6) {
        showAuthError('Password must be at least 6 characters.');
        return;
      }
      if (!terms) {
        showAuthError('Please agree to the Terms of Service & Privacy Policy.');
        return;
      }

      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span>Creating account…</span>';

      try {
        const response = await fetch('/api/auth/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ name, email, password })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          showAuthError(data.error || 'Failed to create account.');
          submitBtn.disabled = false;
          submitBtn.innerHTML = '<span>Create Free Comment2DM Account</span>';
          return;
        }

        if (data.sessionToken) {
          localStorage.setItem('comment2dm_token', data.sessionToken);
        }

        window.location.replace('dashboard.html');
      } catch (err) {
        showAuthError('Unable to create account right now. Please try again.');
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<span>Create Free Comment2DM Account</span>';
      }
    });
  }

  // Pricing monthly / annual toggle
  const pricingToggle = document.getElementById('pricingToggle');
  if (pricingToggle) {
    const buttons = pricingToggle.querySelectorAll('button');
    buttons.forEach(btn => {
      btn.addEventListener('click', function () {
        buttons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const cycle = btn.getAttribute('data-cycle');
        document.querySelectorAll('.price-monthly').forEach(el => {
          el.style.display = cycle === 'monthly' ? '' : 'none';
        });
        document.querySelectorAll('.price-annual').forEach(el => {
          el.style.display = cycle === 'annual' ? '' : 'none';
        });
        document.querySelectorAll('[data-plan-button]').forEach(link => {
          const plan = link.getAttribute('data-plan-button');
          link.href = 'billing.html?plan=' + encodeURIComponent(plan) + '&billing=' + cycle;
        });
      });
    });
  }
})();
