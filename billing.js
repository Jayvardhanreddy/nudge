(function () {
  var title = document.getElementById('checkoutTitle');
  var message = document.getElementById('checkoutMessage');
  var errorBox = document.getElementById('checkoutError');
  var loginLink = document.getElementById('loginLink');
  var params = new URLSearchParams(window.location.search);
  var plan = params.get('plan');
  var billing = params.get('billing') === 'annual' ? 'annual' : 'monthly';
  var allowed = ['creator', 'growth', 'scale'];

  function fail(text) {
    if (message) message.textContent = '';
    if (errorBox) {
      errorBox.textContent = text;
      errorBox.classList.add('show');
    }
  }

  function showLogin() {
    var url = 'login.html?tab=login&plan=' + encodeURIComponent(plan) + '&billing=' + billing;
    window.location.replace(url);
  }

  async function start() {
    if (!allowed.includes(plan)) {
      return fail('Invalid subscription plan. Please choose a plan from the Nudge pricing page.');
    }

    try {
      var session = await fetch('/api/me', { credentials: 'same-origin' });
      if (session.status === 401) return showLogin();
      var sessionData = await session.json().catch(function(){ return {}; });
      if (!session.ok || !sessionData.user) {
        return fail('Unable to verify your Nudge session. Please log in again.');
      }

      var planKey = plan + '_' + billing;
      if (title) title.textContent = 'Secure checkout';
      if (message) message.textContent = 'Your Nudge account is still signed in. Preparing the ' + plan.charAt(0).toUpperCase() + plan.slice(1) + ' subscription…';

      var response = await fetch('/api/billing/create-subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ planKey: planKey })
      });
      var data = await response.json().catch(function(){ return {}; });
      if (!response.ok) throw new Error(data.error || 'Unable to start subscription checkout.');

      if (!window.Razorpay) throw new Error('Payment checkout could not load. Please refresh and try again.');

      var checkout = new Razorpay({
        key: data.keyId,
        subscription_id: data.subscriptionId,
        name: data.name,
        description: plan.charAt(0).toUpperCase() + plan.slice(1) + ' plan',
        prefill: data.prefill,
        theme: { color: '#111111' },
        handler: async function (payment) {
          try {
            var verifyResponse = await fetch('/api/billing/verify-subscription', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'same-origin',
              body: JSON.stringify(payment)
            });
            var verifyData = await verifyResponse.json().catch(function(){ return {}; });
            if (!verifyResponse.ok) throw new Error(verifyData.error || 'Payment verification failed.');
            window.location.replace('dashboard.html?billing=success');
          } catch (error) {
            fail(error.message);
          }
        },
        modal: {
          ondismiss: function () {
            window.location.replace('dashboard.html?billing=cancelled');
          }
        }
      });
      checkout.open();
    } catch (error) {
      fail(error.message || 'Unable to start secure checkout.');
    }
  }

  if (loginLink) {
    loginLink.addEventListener('click', function (event) {
      event.preventDefault();
      showLogin();
    });
  }
  start();
})();