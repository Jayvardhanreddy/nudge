// ============================================================
// Mobile nav toggle
// ============================================================
(function () {
  var toggle = document.getElementById('navToggle');
  var header = document.querySelector('.site-header');
  if (!toggle || !header) return;
  toggle.addEventListener('click', function () {
    header.classList.toggle('nav-open');
  });
  document.querySelectorAll('.main-nav a').forEach(function (link) {
    link.addEventListener('click', function () { header.classList.remove('nav-open'); });
  });
})();

// ============================================================
// FAQ accordion
// ============================================================
(function () {
  var items = document.querySelectorAll('.faq-item');
  items.forEach(function (item) {
    var q = item.querySelector('.faq-q');
    var a = item.querySelector('.faq-a');
    if (!q || !a) return;
    q.addEventListener('click', function () {
      var isOpen = item.classList.contains('open');
      items.forEach(function (other) {
        other.classList.remove('open');
        var otherA = other.querySelector('.faq-a');
        if (otherA) otherA.style.maxHeight = null;
      });
      if (!isOpen) {
        item.classList.add('open');
        a.style.maxHeight = a.scrollHeight + 'px';
      }
    });
  });
})();

// ============================================================
// Pricing monthly / annual toggle
// ============================================================
(function () {
  var wrap = document.getElementById('pricingToggle');
  if (!wrap) return;
  var buttons = wrap.querySelectorAll('button');
  buttons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      buttons.forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      var cycle = btn.getAttribute('data-cycle');
      document.querySelectorAll('.price-monthly').forEach(function (el) {
        el.style.display = cycle === 'monthly' ? '' : 'none';
      });
      document.querySelectorAll('.price-annual').forEach(function (el) {
        el.style.display = cycle === 'annual' ? '' : 'none';
      });
      document.querySelectorAll('[data-plan-button]').forEach(function (link) {
        var plan = link.getAttribute('data-plan-button');
        link.href = 'billing.html?plan=' + encodeURIComponent(plan) + '&billing=' + cycle;
      });
    });
  });
})();

// ============================================================
// Login / signup page: tab switching + basic client-side validation
// ============================================================
(function () {
  var tabs = document.getElementById('authTabs');
  if (!tabs) return;

  var loginForm = document.getElementById('loginForm');
  var signupForm = document.getElementById('signupForm');
  var errorBox = document.getElementById('formError');

  function showTab(name) {
    var isLogin = name === 'login';
    loginForm.style.display = isLogin ? '' : 'none';
    signupForm.style.display = isLogin ? 'none' : '';
    tabs.querySelectorAll('button').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-tab') === name);
    });
    if (errorBox) { errorBox.classList.remove('show'); errorBox.textContent = ''; }
  }

  function setTabFromUrl(name) {
    var tab = name === 'signup' ? 'signup' : 'login';
    showTab(tab);
    return tab;
  }

  tabs.querySelectorAll('button').forEach(function (b) {
    b.addEventListener('click', function () {
      var tab = setTabFromUrl(b.getAttribute('data-tab'));
      var url = new URL(window.location.href);
      url.searchParams.set('tab', tab);
      window.history.replaceState({}, '', url);
    });
  });

  document.querySelectorAll('[data-switch]').forEach(function (link) {
    link.addEventListener('click', function (e) {
      e.preventDefault();
      var tab = setTabFromUrl(link.getAttribute('data-switch'));
      var url = new URL(window.location.href);
      url.searchParams.set('tab', tab);
      window.history.replaceState({}, '', url);
    });
  });

  // Explicitly initialize the form for every URL state. The markup defaults to login.
  var params = new URLSearchParams(window.location.search);
  setTabFromUrl(params.get('tab'));

  function showError(message) {
    if (!errorBox) return;
    errorBox.textContent = message;
    errorBox.classList.add('show');
  }

  async function submitAuth(url, payload) {
    var response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload)
      });
    } catch (error) {
      throw new Error('Unable to reach the authentication server. Please check your internet connection and try again.');
    }
    var data = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(data.error || 'Unable to complete the request.');
    return data;
  }

  function continueToSelectedPlan() {
    var q = new URLSearchParams(window.location.search);
    var plan = q.get('plan');
    if (!plan || plan === 'free') {
      window.location.replace('dashboard.html');
      return;
    }
    var billing = q.get('billing') === 'annual' ? 'annual' : 'monthly';
    // Authentication must never create a subscription. The dedicated
    // billing page performs exactly one checkout initialization.
    window.location.replace('billing.html?plan=' + encodeURIComponent(plan) + '&billing=' + billing);
  }

  loginForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var email = document.getElementById('loginEmail').value.trim();
    var password = document.getElementById('loginPassword').value;
    if (!email || !password) {
      showError('Enter your email and password to continue.');
      return;
    }
    errorBox.classList.remove('show');
    submitAuth('/api/auth/login', { email: email, password: password })
      .then(function () { var q = new URLSearchParams(window.location.search); if (q.get('connect') === 'instagram') { window.location.replace('/api/instagram/authorize'); return; } continueToSelectedPlan(); })
      .catch(function (error) { showError(error.message); });
  });

  signupForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var name = document.getElementById('signupName').value.trim();
    var email = document.getElementById('signupEmail').value.trim();
    var password = document.getElementById('signupPassword').value;
    var terms = signupForm.querySelector('[name="terms"]').checked;
    if (!name || !email || !password) {
      showError('Fill in every field to create your account.');
      return;
    }
    if (password.length < 8) {
      showError('Password needs to be at least 8 characters.');
      return;
    }
    if (!terms) {
      showError('You need to accept the Terms & Privacy Policy to continue.');
      return;
    }
    errorBox.classList.remove('show');
    submitAuth('/api/auth/signup', { name: name, email: email, password: password })
      .then(function () { var q = new URLSearchParams(window.location.search); if (q.get('connect') === 'instagram') { window.location.href = '/api/instagram/authorize'; return; } return continueToSelectedPlan(); })
      .catch(function (error) { showError(error.message); });
  });
})();


// ============================================================
// OAuth buttons
// ============================================================
(function () {
  var buttons = document.querySelectorAll('.oauth-btn');
  if (!buttons.length) return;
  var errorBox = document.getElementById('formError');
  function showAuthError(message) {
    if (!errorBox) return;
    errorBox.textContent = message;
    errorBox.classList.add('show');
  }
  buttons.forEach(function (button) {
    button.addEventListener('click', async function () {
      var label = (button.textContent || '').toLowerCase();
      button.disabled = true;
      try {
        if (label.indexOf('google') !== -1) {
          window.location.href = '/api/auth/google';
          return;
        }
        var session = await fetch('/api/me', { credentials: 'same-origin' });
        if (session.ok) {
          window.location.href = '/api/instagram/authorize';
          return;
        }
        var url = new URL(window.location.href);
        url.searchParams.set('tab', 'signup');
        url.searchParams.set('connect', 'instagram');
        window.location.href = url.toString();
      } catch (error) {
        showAuthError('Unable to start the sign-in flow. Please try again.');
        button.disabled = false;
      }
    });
  });
  var params = new URLSearchParams(window.location.search);
  var authError = params.get('auth_error');
  if (authError) showAuthError(authError);
})();
