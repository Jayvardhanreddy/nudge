(function () {
  var key = 'nudge_cookie_consent';
  function track(name) {
    if (localStorage.getItem(key) !== 'accepted') return;
    if (window.NUDGE_ANALYTICS && typeof window.NUDGE_ANALYTICS.track === 'function') {
      window.NUDGE_ANALYTICS.track(name);
    }
  }
  if (localStorage.getItem(key) !== 'accepted' && localStorage.getItem(key) !== 'declined') {
    var banner = document.createElement('aside');
    banner.className = 'cookie-consent';
    banner.setAttribute('aria-label', 'Cookie consent');
    banner.innerHTML = '<p>We use optional analytics cookies to improve Nudge. <a href="privacy.html">Learn more</a>.</p><div><button type="button" data-consent="decline">Decline</button> <button type="button" data-consent="accept">Accept</button></div>';
    document.body.appendChild(banner);
    banner.querySelectorAll('[data-consent]').forEach(function (button) {
      button.addEventListener('click', function () {
        localStorage.setItem(key, button.getAttribute('data-consent') === 'accept' ? 'accepted' : 'declined');
        banner.remove();
        if (button.getAttribute('data-consent') === 'accept') track('cookie_consent');
      });
    });
  }
  window.addEventListener('click', function (event) {
    var link = event.target.closest && event.target.closest('a.btn-accent');
    if (link) track('cta_click');
  });
})();
