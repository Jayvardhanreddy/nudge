// help.js — Comment2DM Help Desk
(function () {
  'use strict';

  // ── FAQ Data ───────────────────────────────────────────────────────────────
  const faqs = [
    {
      q: 'How do Instagram automations work?',
      a: 'When someone comments on your Instagram reel, Comment2DM detects it via Meta\'s webhook and automatically sends that person a DM with your pre-set message. It also replies in the comment thread to acknowledge the DM. Your account must be a Business or Creator account.'
    },
    {
      q: 'Why is my DM not being sent?',
      a: 'Check that: (1) your Instagram account is still connected in Instagram Accounts, (2) the automation is toggled ON, (3) the reel still exists and is public, and (4) you haven\'t exceeded your monthly DM limit. Contact support if issues persist.'
    },
    {
      q: 'How do I connect my Instagram account?',
      a: 'Go to Instagram Accounts → Connect Account. You\'ll be redirected to Meta\'s login page. Approve the permissions and you\'re connected. Your account must be a Business or Creator account — personal accounts do not support DM automation via the API.'
    },
    {
      q: 'What triggers an automation?',
      a: 'You can trigger automations in two ways: (1) Keyword trigger — only fires when a comment contains a specific keyword (e.g., "link", "info"), or (2) All Comments trigger (Pro & Elite plans) — fires for every comment on the selected reel.'
    },
    {
      q: 'Is this safe? Will Instagram ban my account?',
      a: 'Comment2DM is built on Meta\'s official API and complies with all Instagram platform policies. We do not use bots or browser automation. However, always ensure you are not spamming and your messages follow Instagram\'s Community Guidelines.'
    },
    {
      q: 'How do I upgrade my plan?',
      a: 'Go to Billing → View Plans, or visit the Pricing page. Click Upgrade on the plan you want and complete the Razorpay checkout. Your plan is upgraded instantly after successful payment.'
    },
    {
      q: 'What is the Free plan limit?',
      a: 'The Free plan allows 1 Instagram account, 3 automations, 300 DMs per month, and 100 AI credits. Keyword triggers only — the "All Comments" trigger is available on Pro and Elite plans.'
    },
    {
      q: 'How do I disconnect an Instagram account?',
      a: 'Go to Instagram Accounts → click the account → Disconnect. This will also pause all automations linked to that account. Your automation settings are preserved so you can reconnect and resume later.'
    }
  ];

  // ── Render FAQ ─────────────────────────────────────────────────────────────
  function renderFaq() {
    const container = document.getElementById('faqList');
    if (!container) return;
    container.innerHTML = faqs.map((faq, i) => `
      <div class="faq-item" id="faq-${i}">
        <div class="faq-question" data-index="${i}">
          <span>${faq.q}</span>
          <span class="faq-arrow">▼</span>
        </div>
        <div class="faq-answer">
          <p>${faq.a}</p>
        </div>
      </div>
    `).join('');

    container.querySelectorAll('.faq-question').forEach(q => {
      q.addEventListener('click', () => {
        const item = document.getElementById('faq-' + q.dataset.index);
        if (!item) return;
        const isOpen = item.classList.contains('open');
        // Close all
        container.querySelectorAll('.faq-item').forEach(it => it.classList.remove('open'));
        if (!isOpen) item.classList.add('open');
      });
    });
  }

  // ── Bot response logic ─────────────────────────────────────────────────────
  function getBotResponse(msg) {
    const m = msg.toLowerCase();
    if (m.includes('connect') || m.includes('instagram') || m.includes('account')) {
      return 'To connect Instagram, go to <strong>Instagram Accounts → Connect Account</strong>. Your account must be a Business or Creator account. Personal accounts don\'t support DM automation via the Meta API.';
    }
    if (m.includes('billing') || m.includes('plan') || m.includes('upgrade') || m.includes('price')) {
      return 'To upgrade, visit <strong>Billing → View Plans</strong> or the <a href="pricing.html" style="color:#818cf8;">Pricing page</a>. We accept all major cards via Razorpay. For billing issues, email <strong>billing@comment2dm.com</strong>.';
    }
    if (m.includes('not working') || m.includes('error') || m.includes('fail') || m.includes('issue')) {
      return 'For automation failures: (1) Check your Instagram account is still connected. (2) Ensure the automation is toggled ON. (3) Check your monthly DM limit. If issues persist, email <strong>support@comment2dm.com</strong> — we\'ll investigate within 24 hours.';
    }
    if (m.includes('limit') || m.includes('quota') || m.includes('free')) {
      return 'The <strong>Free plan</strong> includes 300 DMs/month, 3 automations, and 1 Instagram account. Upgrade to <strong>Pro</strong> for 5,000 DMs/month or <strong>Elite</strong> for 50,000 DMs/month.';
    }
    if (m.includes('delete') || m.includes('cancel')) {
      return 'To delete your account, go to <strong>Settings → Danger Zone → Delete Account</strong>. To cancel your subscription only, go to <strong>Billing</strong> and select Cancel Subscription.';
    }
    if (m.includes('safe') || m.includes('ban') || m.includes('policy')) {
      return 'Comment2DM uses Meta\'s official API and is fully compliant with Instagram\'s platform policies. We never use bots or browser automation. Your account is safe.';
    }
    return 'Thanks for reaching out! Our support team responds within 24 hours. For urgent issues, email <strong>support@comment2dm.com</strong>. You can also check our FAQ above for quick answers.';
  }

  // ── Chat ───────────────────────────────────────────────────────────────────
  const messagesEl = document.getElementById('chatMessages');

  function timeNow() {
    const d = new Date();
    return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  }

  function addBotMsg(text) {
    if (!messagesEl) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = `<div class="chat-bubble bot">${text}</div><div class="chat-time">${timeNow()}</div>`;
    messagesEl.appendChild(wrap);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function addUserMsg(text) {
    if (!messagesEl) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = `<div class="chat-bubble user">${text}</div><div class="chat-time right">${timeNow()}</div>`;
    messagesEl.appendChild(wrap);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function showTyping() {
    if (!messagesEl) return null;
    const el = document.createElement('div');
    el.className = 'typing-dots';
    el.id = 'typingIndicator';
    el.innerHTML = '<span></span><span></span><span></span>';
    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return el;
  }

  function removeTyping() {
    document.getElementById('typingIndicator')?.remove();
  }

  async function sendMessage(text) {
    if (!text.trim()) return;
    addUserMsg(text);
    const typing = showTyping();

    // Try API first, fallback to local bot
    let reply = null;
    try {
      const res = await fetch('/api/support/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(window.getAuthHeaders ? window.getAuthHeaders() : {}) },
        body: JSON.stringify({ message: text })
      });
      if (res.ok) {
        const data = await res.json();
        reply = data.reply;
      }
    } catch { /* use local */ }

    await new Promise(r => setTimeout(r, 1200 + Math.random() * 400));
    removeTyping();
    addBotMsg(reply || getBotResponse(text));
  }

  // Event handlers
  document.getElementById('chatSendBtn')?.addEventListener('click', () => {
    const input = document.getElementById('chatInput');
    if (!input) return;
    const txt = input.value.trim();
    if (!txt) return;
    input.value = '';
    sendMessage(txt);
  });

  document.getElementById('chatInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const input = e.target;
      const txt = input.value.trim();
      if (!txt) return;
      input.value = '';
      sendMessage(txt);
    }
  });

  document.querySelectorAll('.quick-reply-btn').forEach(btn => {
    btn.addEventListener('click', () => sendMessage(btn.dataset.msg));
  });

  // ── Init ───────────────────────────────────────────────────────────────────
  function init() {
    renderFaq();
    // Greeting message
    setTimeout(() => {
      addBotMsg('👋 Hi there! I\'m the Comment2DM support bot. How can I help you today? You can ask about connecting Instagram, automations, billing, or anything else!');
    }, 600);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();