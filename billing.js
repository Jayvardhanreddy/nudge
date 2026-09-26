// billing.js — Comment2DM Billing Page
(function () {
  'use strict';

  let isAnnual = false;
  let currentPlan = 'free';
  let userEmail = '';

  const PLANS = {
    free:  { name: 'Free',  monthlyPrice: 0,    annualPrice: 0,    features: ['1 Instagram account','3 automations','300 DMs / month','100 AI credits','Keyword triggers only'], missing: ['All Comments trigger','Priority support','Analytics export'] },
    pro:   { name: 'Pro',   monthlyPrice: 999,  annualPrice: 9990, features: ['3 Instagram accounts','25 automations','5,000 DMs / month','2,500 AI credits','All comment triggers','Priority support'], missing: ['Analytics export','Custom webhooks'] },
    elite: { name: 'Elite', monthlyPrice: 2499, annualPrice: 24990,features: ['10 Instagram accounts','Unlimited automations','50,000 DMs / month','30,000 AI credits','All features unlocked','Dedicated support','Analytics export','Custom webhooks'], missing: [] }
  };

  // ── Toast ──────────────────────────────────────────────────────────────────
  function showToast(msg, type = 'success') {
    const c = document.getElementById('toastContainer');
    if (!c) return;
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.textContent = msg;
    c.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 4000);
  }

  // ── Render plan cards ─────────────────────────────────────────────────────
  function renderPlanCards() {
    const container = document.getElementById('planCards');
    if (!container) return;

    container.innerHTML = Object.entries(PLANS).map(([key, plan]) => {
      const basePrice = isAnnual ? plan.annualPrice : plan.monthlyPrice;
      const discountAmount = appliedDiscount > 0 ? (basePrice * (appliedDiscount / 100)) : 0;
      const finalPrice = Math.max(0, basePrice - discountAmount);

      const isCurrent = key === currentPlan;
      const isPopular = key === 'pro';
      
      let priceDisplay = '₹0';
      if (finalPrice > 0) {
        priceDisplay = `₹${Math.round(finalPrice).toLocaleString('en-IN')}`;
      }
      
      let originalDisplay = '';
      if (appliedDiscount > 0 && basePrice > 0) {
        originalDisplay = `<s style="opacity:0.5;font-size:0.8rem;margin-right:6px;">₹${basePrice.toLocaleString('en-IN')}</s>`;
      }
      
      const period = basePrice === 0 ? 'Forever free' : (isAnnual ? '/ year' : '/ month');
      const originalMonthly = isAnnual && plan.monthlyPrice > 0 && !appliedDiscount ? `₹${(plan.monthlyPrice * 12).toLocaleString('en-IN')} /yr` : '';

      let btnClass = key;
      let btnText = isCurrent ? '✓ Current Plan' : key === 'free' ? 'Downgrade to Free' : `Upgrade to ${plan.name}`;
      if (isCurrent) btnClass = 'current-btn';

      const features = plan.features.map(f => `<li>${f}</li>`).join('');
      const missing = plan.missing.map(f => `<li class="miss">${f}</li>`).join('');

      return `<div class="plan-card ${isPopular ? 'popular' : ''} ${isCurrent ? 'current' : ''}">
        ${isPopular ? '<div class="popular-badge">⭐ Most Popular</div>' : ''}
        <div class="plan-name">${plan.name}</div>
        <div class="plan-price">
          ${originalDisplay}
          <span class="amount">${priceDisplay}</span>
          <span class="period">${period}</span>
          ${originalMonthly ? `<span class="original">${originalMonthly}</span>` : ''}
        </div>
        <div class="plan-desc">${key === 'free' ? 'Perfect to get started' : key === 'pro' ? 'For growing creators' : 'For power users & agencies'}</div>
        <ul class="plan-features">${features}${missing}</ul>
        <button class="plan-cta ${btnClass}" data-plan="${key}" ${isCurrent ? 'disabled' : ''}>${btnText}</button>
      </div>`;
    }).join('');

    container.querySelectorAll('.plan-cta:not([disabled])').forEach(btn => {
      btn.addEventListener('click', () => initiateCheckout(btn.dataset.plan));
    });
  }

  // ── Coupons ───────────────────────────────────────────────────────────────
  let appliedDiscount = 0;
  let appliedCouponCode = '';

  const applyBtn = document.getElementById('applyCouponBtn');
  const couponInput = document.getElementById('couponCodeInput');
  const couponMsg = document.getElementById('couponMessage');

  if (applyBtn) {
    applyBtn.addEventListener('click', async () => {
      const code = couponInput.value.trim().toUpperCase();
      if (!code) return;
      try {
        const res = await fetch('/api/billing/validate-coupon', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...window.getAuthHeaders() },
          body: JSON.stringify({ code })
        });
        const data = await res.json();
        if (data.valid) {
          appliedDiscount = data.discount;
          appliedCouponCode = code;
          couponMsg.textContent = `Coupon applied: ${data.discount}% OFF! 🎉`;
          couponMsg.style.color = '#10b981';
          couponMsg.hidden = false;
          renderPlanCards();
        } else {
          couponMsg.textContent = '❌ Invalid or expired coupon code.';
          couponMsg.style.color = '#f43f5e';
          couponMsg.hidden = false;
          appliedDiscount = 0;
          appliedCouponCode = '';
          renderPlanCards();
        }
      } catch (e) {
        console.error(e);
      }
    });
  }

  // ── Initiate Razorpay checkout ─────────────────────────────────────────────
  async function initiateCheckout(plan) {
    if (plan === 'free') {
      showToast('Contact support to downgrade to Free plan.', 'error');
      return;
    }
    try {
      const planKey = plan + (isAnnual ? '_annual' : '_monthly');

      const res = await fetch('/api/billing/create-subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(window.getAuthHeaders ? window.getAuthHeaders() : {}) },
        body: JSON.stringify({ planKey })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create subscription');

      const options = {
        key: data.keyId || 'rzp_test_placeholder',
        subscription_id: data.subscriptionId,
        name: data.name || 'Comment2DM',
        description: `Upgrade to ${planKey}`,
        prefill: data.prefill || { email: userEmail },
        theme: { color: '#6366f1' },
        handler: async (response) => {
          try {
            const verifyRes = await fetch('/api/billing/verify-subscription', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...(window.getAuthHeaders ? window.getAuthHeaders() : {}) },
              body: JSON.stringify({ 
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_subscription_id: response.razorpay_subscription_id,
                razorpay_signature: response.razorpay_signature,
                planKey
              })
            });
            const vd = await verifyRes.json();
            if (!verifyRes.ok) throw new Error(vd.error || 'Verification failed');
            showToast(`🎉 Upgraded to ${plan}! Welcome aboard.`);
            setTimeout(() => location.reload(), 2000);
          } catch (err) {
            showToast('❌ Payment verification failed: ' + err.message, 'error');
          }
        }
      };

      if (typeof Razorpay === 'undefined') {
        showToast('❌ Razorpay not loaded. Check your internet connection.', 'error');
        return;
      }
      const rzp = new Razorpay(options);
      rzp.open();
    } catch (err) {
      showToast('❌ ' + err.message, 'error');
    }
  }

  // ── Load billing status and dynamic prices ────────────────────────────────
  async function loadBillingStatus() {
    try {
      // First fetch dynamic prices
      const priceRes = await fetch('/api/billing/prices');
      if (priceRes.ok) {
        const prices = await priceRes.json();
        PLANS.pro.monthlyPrice = prices.pro_monthly || 999;
        PLANS.pro.annualPrice = (prices.pro_monthly || 999) * 10;
        PLANS.elite.monthlyPrice = prices.elite_monthly || 2499;
        PLANS.elite.annualPrice = (prices.elite_monthly || 2499) * 10;
      }

      // Then fetch user billing status
      const res = await fetch('/api/billing/status', { headers: window.getAuthHeaders ? window.getAuthHeaders() : {} });
      if (!res.ok) { renderPlanCards(); return; }
      
      const data = await res.json();
      currentPlan = (data.plan || 'free').toLowerCase();
      const used = data.usage?.dmMonthly || 0;
      const limit = data.limits?.dmMonthly || 300;
      const pct = Math.min(100, Math.round((used / limit) * 100));
      const planName = currentPlan.charAt(0).toUpperCase() + currentPlan.slice(1);

      const pn = document.getElementById('currentPlanName');
      const pb = document.getElementById('currentPlanBadge');
      const bar = document.getElementById('dmUsageBar');
      const txt = document.getElementById('dmUsageText');
      if (pn) pn.textContent = planName;
      if (pb) { pb.textContent = planName; pb.className = `plan-badge ${currentPlan}`; }
      if (bar) bar.style.width = pct + '%';
      if (txt) txt.textContent = `${used.toLocaleString()} / ${limit.toLocaleString()}`;

      renderPlanCards();
    } catch {
      renderPlanCards();
    }
  }

  // ── Load user email ────────────────────────────────────────────────────────
  async function loadUser() {
    try {
      const res = await fetch('/api/auth/me', { headers: window.getAuthHeaders ? window.getAuthHeaders() : {} });
      if (!res.ok) return;
      const data = await res.json();
      userEmail = (data.user || data).email || '';
    } catch {}
  }

  // ── Load payment history ───────────────────────────────────────────────────
  async function loadHistory() {
    try {
      const res = await fetch('/api/billing/history', { headers: window.getAuthHeaders ? window.getAuthHeaders() : {} });
      if (!res.ok) return;
      const data = await res.json();
      const payments = data.payments || data || [];
      const tbody = document.getElementById('historyBody');
      if (!tbody) return;
      if (!payments.length) return;

      tbody.innerHTML = payments.map(p => {
        const status = p.status === 'paid' ? '<span style="color:#10b981;">✅ Paid</span>' : p.status === 'failed' ? '<span style="color:#f43f5e;">❌ Failed</span>' : '<span style="color:#f59e0b;">⏳ Pending</span>';
        const date = new Date(p.createdAt || p.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
        const amount = p.amount ? `₹${(p.amount / 100).toLocaleString('en-IN')}` : '–';
        const plan = p.plan ? p.plan.charAt(0).toUpperCase() + p.plan.slice(1) : '–';
        return `<tr><td>${date}</td><td>${plan}</td><td>${amount}</td><td>${status}</td></tr>`;
      }).join('');
    } catch {}
  }

  // ── Annual toggle ──────────────────────────────────────────────────────────
  document.getElementById('annualToggle')?.addEventListener('change', (e) => {
    isAnnual = e.target.checked;
    renderPlanCards();
  });

  // ── Init ──────────────────────────────────────────────────────────────────
  function init() {
    loadUser();
    loadBillingStatus();
    loadHistory();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();