// ============================================================
// Comment2DM — Automations Management & Multi-Step Builder
// High-performance, zero-lag, visual Reel picker & live simulator
// ============================================================

(function () {
  let userAccounts = [];
  let userAutomations = [];
  let loadedReels = [];

  const openCreateBtn = document.getElementById('openCreateBtn');
  const createFirstBtn = document.getElementById('createFirstBtn');
  const cancelFormBtn = document.getElementById('cancelFormBtn');
  const cancelFormBtn2 = document.getElementById('cancelFormBtn2');
  const automationFormCard = document.getElementById('automationFormCard');
  const automationsListSection = document.getElementById('automationsListSection');
  const automationsListGrid = document.getElementById('automationsListGrid');
  const automationsEmptyState = document.getElementById('automationsEmptyState');
  const noAccountWarning = document.getElementById('noAccountWarning');
  const automationForm = document.getElementById('automationForm');
  const accountSelect = document.getElementById('automationAccountSelect');
  const saveBtn = document.getElementById('saveAutomationBtn');

  // Simulator elements
  const simComment = document.getElementById('simCommentDisplay');
  const simPublicReply = document.getElementById('simPublicReplyDisplay');
  const simDm = document.getElementById('simDmDisplay');

  const keywordInput = document.getElementById('automationKeywordInput');
  const dmMessageInput = document.getElementById('automationDmMessageInput');
  const publicReplyInput = document.getElementById('automationPublicReplyInput');

  // Specific reel vs all reels toggle
  const targetAllBtn = document.getElementById('targetAllReelsBtn');
  const targetSpecificBtn = document.getElementById('targetSpecificReelBtn');
  const reelPickerBox = document.getElementById('reelPickerBox');
  const reelPickerGrid = document.getElementById('reelPickerGrid');
  const refreshReelsBtn = document.getElementById('refreshReelsBtn');
  const selectedMediaIdInput = document.getElementById('selectedMediaId');
  const selectedMediaUrlInput = document.getElementById('selectedMediaUrl');
  const selectedReelPreview = document.getElementById('selectedReelPreview');
  const selectedReelText = document.getElementById('selectedReelText');

  // Trigger radio
  const triggerKeywordRadio = document.getElementById('triggerKeywordRadio');
  const triggerAllRadio = document.getElementById('triggerAllRadio');
  const keywordGroup = document.getElementById('keywordInputGroup');

  function showNotice(msg) {
    const notice = document.getElementById('automationNotice');
    if (!notice) return;
    notice.textContent = msg;
    notice.hidden = false;
    setTimeout(() => { notice.hidden = true; }, 4000);
  }

  function showError(msg) {
    const errorBox = document.getElementById('dashboardError');
    if (!errorBox) return;
    errorBox.textContent = msg;
    errorBox.classList.add('show');
    setTimeout(() => { errorBox.classList.remove('show'); }, 5000);
  }

  // Update simulator live
  function updateSimulator() {
    const isAll = triggerAllRadio.checked;
    const kw = keywordInput.value.trim() || 'LINK';
    const dm = dmMessageInput.value.trim() || 'Hey! Thanks for commenting. Here is your direct link: https://yourbrand.com/deal 🔥';
    const reply = publicReplyInput.value.trim();

    if (simComment) {
      simComment.innerHTML = isAll
        ? '💬 "Awesome video! 🔥"'
        : `💬 "Can you send the <strong>${kw.toUpperCase()}</strong>?"`;
    }
    if (simPublicReply) {
      if (reply) {
        simPublicReply.style.display = 'block';
        simPublicReply.textContent = `↳ @yourpage: "${reply}"`;
      } else {
        simPublicReply.style.display = 'none';
      }
    }
    if (simDm) {
      simDm.textContent = dm;
    }
  }

  [keywordInput, dmMessageInput, publicReplyInput].forEach(el => {
    if (el) el.addEventListener('input', updateSimulator);
  });

  if (triggerKeywordRadio && triggerAllRadio) {
    triggerKeywordRadio.addEventListener('change', () => {
      keywordGroup.style.display = 'block';
      updateSimulator();
    });
    triggerAllRadio.addEventListener('change', () => {
      keywordGroup.style.display = 'none';
      updateSimulator();
    });
  }

  // Reel target toggle
  if (targetAllBtn && targetSpecificBtn && reelPickerBox) {
    targetAllBtn.addEventListener('click', () => {
      targetAllBtn.classList.add('active');
      targetAllBtn.style.borderColor = 'var(--accent)';
      targetSpecificBtn.classList.remove('active');
      targetSpecificBtn.style.borderColor = 'transparent';
      reelPickerBox.style.display = 'none';
      selectedMediaIdInput.value = '';
      selectedMediaUrlInput.value = '';
      if (selectedReelPreview) selectedReelPreview.style.display = 'none';
    });

    targetSpecificBtn.addEventListener('click', () => {
      targetSpecificBtn.classList.add('active');
      targetSpecificBtn.style.borderColor = 'var(--accent)';
      targetAllBtn.classList.remove('active');
      targetAllBtn.style.borderColor = 'transparent';
      reelPickerBox.style.display = 'block';
      loadReelsForSelectedAccount(false);
    });
  }

  // Load published reels from Meta API
  async function loadReelsForSelectedAccount(force = false) {
    const igUserId = accountSelect.value;
    if (!igUserId) return;

    reelPickerGrid.innerHTML = '<div style="text-align:center; padding:24px; color:var(--ink-muted); grid-column:1/-1;">Loading reels from Instagram…</div>';

    try {
      const res = await fetch(`/api/instagram/accounts/${encodeURIComponent(igUserId)}/reels${force ? '?refresh=1' : ''}`, {
        headers: window.getAuthHeaders(),
        credentials: 'same-origin'
      });
      const data = await res.json().catch(() => ({}));
      loadedReels = data.reels || [];

      if (loadedReels.length === 0) {
        reelPickerGrid.innerHTML = '<div style="text-align:center; padding:24px; color:var(--ink-muted); grid-column:1/-1;">No Reels or Posts found for this account. Create one on Instagram to target it specifically!</div>';
        return;
      }

      reelPickerGrid.innerHTML = '';
      loadedReels.forEach(reel => {
        const card = document.createElement('div');
        card.className = 'reel-choice-card';
        if (selectedMediaIdInput.value === reel.id) card.classList.add('selected');

        const thumb = reel.thumbnailUrl || 'https://placehold.co/180x320/121217/6366f1?text=Reel';
        const title = (reel.caption || 'Reel').slice(0, 30);

        card.innerHTML = `
          <img src="${thumb}" class="reel-thumb-img" alt="Reel thumbnail" loading="lazy" />
          <div class="reel-choice-badge">🎬 ${reel.commentsCount || 0} comments</div>
        `;

        card.addEventListener('click', () => {
          document.querySelectorAll('.reel-choice-card').forEach(c => c.classList.remove('selected'));
          card.classList.add('selected');
          selectedMediaIdInput.value = reel.id;
          selectedMediaUrlInput.value = reel.permalink || '';
          if (selectedReelPreview) {
            selectedReelPreview.style.display = 'block';
            selectedReelText.textContent = `"${title}…" (ID: ${reel.id})`;
          }
        });

        reelPickerGrid.appendChild(card);
      });
    } catch (e) {
      reelPickerGrid.innerHTML = '<div style="text-align:center; padding:24px; color:var(--rose); grid-column:1/-1;">Failed to load reels. Check Instagram connection.</div>';
    }
  }

  if (refreshReelsBtn) {
    refreshReelsBtn.addEventListener('click', () => loadReelsForSelectedAccount(true));
  }

  if (accountSelect) {
    accountSelect.addEventListener('change', () => {
      if (targetSpecificBtn.classList.contains('active')) {
        loadReelsForSelectedAccount(false);
      }
    });
  }

  // Open & Close Builder Form
  function openBuilder(automation = null) {
    if (userAccounts.length === 0) {
      showError('Please connect an Instagram account first.');
      return;
    }

    automationFormCard.hidden = false;
    automationFormCard.scrollIntoView({ behavior: 'smooth' });

    if (automation) {
      document.getElementById('formHeadingTitle').textContent = 'Edit Automation';
      document.getElementById('automationId').value = automation.id;
      accountSelect.value = automation.instagramUserId;
      keywordInput.value = automation.keyword || '';
      dmMessageInput.value = automation.dmMessage || '';
      publicReplyInput.value = automation.replyTemplate || '';
      document.getElementById('automationEnabledCheckbox').checked = Boolean(automation.enabled);

      if (automation.triggerType === 'all') {
        triggerAllRadio.checked = true;
        keywordGroup.style.display = 'none';
      } else {
        triggerKeywordRadio.checked = true;
        keywordGroup.style.display = 'block';
      }

      if (automation.mediaId || automation.mediaUrl) {
        targetSpecificBtn.click();
        selectedMediaIdInput.value = automation.mediaId || '';
        selectedMediaUrlInput.value = automation.mediaUrl || '';
      } else {
        targetAllBtn.click();
      }
    } else {
      document.getElementById('formHeadingTitle').textContent = 'Create New Automation';
      document.getElementById('automationId').value = '';
      keywordInput.value = '';
      dmMessageInput.value = '';
      publicReplyInput.value = 'Sent to your DM! Check inbox 📩';
      document.getElementById('automationEnabledCheckbox').checked = true;
      triggerKeywordRadio.checked = true;
      keywordGroup.style.display = 'block';
      targetAllBtn.click();
    }

    updateSimulator();
  }

  function closeBuilder() {
    automationFormCard.hidden = true;
    automationForm.reset();
  }

  if (openCreateBtn) openCreateBtn.addEventListener('click', () => openBuilder(null));
  if (createFirstBtn) createFirstBtn.addEventListener('click', () => openBuilder(null));
  if (cancelFormBtn) cancelFormBtn.addEventListener('click', closeBuilder);
  if (cancelFormBtn2) cancelFormBtn2.addEventListener('click', closeBuilder);

  // Form Submission (Fast, Optimistic, No Lag)
  if (automationForm) {
    automationForm.addEventListener('submit', async function (e) {
      e.preventDefault();

      const id = document.getElementById('automationId').value;
      const igUserId = accountSelect.value;
      const isAll = triggerAllRadio.checked;
      const kw = keywordInput.value.trim();
      const dm = dmMessageInput.value.trim();
      const reply = publicReplyInput.value.trim();
      const enabled = document.getElementById('automationEnabledCheckbox').checked;
      const mediaId = selectedMediaIdInput.value;
      const mediaUrl = selectedMediaUrlInput.value;

      if (!igUserId) { showError('Please select an Instagram account.'); return; }
      if (!isAll && !kw) { showError('Please enter a trigger keyword.'); return; }
      if (!dm) { showError('Please write a private DM message.'); return; }

      // Disable button immediately to prevent double submissions
      saveBtn.disabled = true;
      saveBtn.innerHTML = '<span>Saving automation…</span>';

      try {
        const url = id ? `/api/automations/${encodeURIComponent(id)}` : '/api/automations';
        const method = id ? 'PATCH' : 'POST';

        const res = await fetch(url, {
          method,
          headers: {
            'Content-Type': 'application/json',
            ...window.getAuthHeaders()
          },
          credentials: 'same-origin',
          body: JSON.stringify({
            instagramUserId: igUserId,
            keyword: isAll ? '*' : kw,
            triggerType: isAll ? 'all' : 'keyword',
            dmMessage: dm,
            replyTemplate: reply,
            enabled,
            mediaId,
            mediaUrl
          })
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          showError(data.error || 'Failed to save automation.');
          saveBtn.disabled = false;
          saveBtn.innerHTML = '<span>Save Automation</span>';
          return;
        }

        const saved = data.automation;
        if (saved) {
          if (id) {
            userAutomations = userAutomations.map(a => String(a.id) === String(id) ? saved : a);
          } else {
            userAutomations.unshift(saved);
          }
          renderAutomations();
        }

        closeBuilder();
        showNotice(id ? 'Automation updated successfully! ⚡' : 'Automation created and active! ⚡');
      } catch (err) {
        showError('Network error. Unable to save automation.');
      } finally {
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<span>Save Automation</span>';
      }
    });
  }

  // Render Automations List
  function renderAutomations() {
    automationsListGrid.innerHTML = '';

    if (userAutomations.length === 0) {
      automationsEmptyState.hidden = false;
      return;
    }
    automationsEmptyState.hidden = true;

    userAutomations.forEach(auto => {
      const card = document.createElement('div');
      card.className = 'apple-card';
      card.style.display = 'flex';
      card.style.alignItems = 'center';
      card.style.justifyContent = 'space-between';
      card.style.flexWrap = 'wrap';
      card.style.gap = '16px';
      card.style.padding = '20px 24px';

      const isAll = auto.triggerType === 'all' || auto.keyword === '*';
      const scopeLabel = auto.mediaUrl ? 'Specific Reel' : 'All Reels & Posts';
      const replyPreview = auto.replyTemplate ? `↳ Public reply: "${auto.replyTemplate}"` : 'No public reply';

      card.innerHTML = `
        <div style="display:flex; align-items:flex-start; gap:16px;">
          <div style="width:44px; height:44px; border-radius:12px; background:var(--accent-gradient); display:flex; align-items:center; justify-content:center; color:#fff; font-size:1.3rem; flex-shrink:0;">
            ⚡
          </div>
          <div>
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
              <strong style="color:#fff; font-size:1rem;">@${auto.username || 'instagram'}</strong>
              <span class="plan-badge ${auto.enabled ? 'pro' : ''}" style="font-size:0.72rem; color:${auto.enabled ? 'var(--emerald)' : 'var(--ink-muted)'};">
                ${auto.enabled ? '● Active' : '○ Paused'}
              </span>
              <span class="plan-badge" style="font-size:0.72rem;">${scopeLabel}</span>
            </div>
            <div style="font-size:0.86rem; color:var(--ink-secondary); margin-bottom:4px;">
              Trigger: <strong style="color:var(--accent-light);">${isAll ? 'Any Comment (All)' : `"${auto.keyword}"`}</strong>
            </div>
            <div style="font-size:0.82rem; color:var(--ink-muted);">
              DM: "${auto.dmMessage}"
            </div>
            <small style="display:block; font-size:0.76rem; color:var(--ink-muted); margin-top:4px;">
              ${replyPreview}
            </small>
          </div>
        </div>

        <div style="display:flex; align-items:center; gap:10px;">
          <button class="btn btn-ghost btn-sm toggle-auto-btn" style="padding:6px 14px;">
            ${auto.enabled ? 'Pause' : 'Activate'}
          </button>
          <button class="btn btn-ghost btn-sm edit-auto-btn" style="padding:6px 14px;">
            Edit
          </button>
          <button class="btn btn-ghost btn-sm delete-auto-btn" style="padding:6px 14px; color:var(--rose);">
            Delete
          </button>
        </div>
      `;

      // Toggle Active / Paused
      card.querySelector('.toggle-auto-btn').addEventListener('click', async () => {
        const newEnabled = !auto.enabled;
        try {
          await fetch(`/api/automations/${encodeURIComponent(auto.id)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', ...window.getAuthHeaders() },
            credentials: 'same-origin',
            body: JSON.stringify({ enabled: newEnabled })
          });
          auto.enabled = newEnabled;
          renderAutomations();
          showNotice(newEnabled ? 'Automation activated!' : 'Automation paused.');
        } catch (e) {
          showError('Failed to update status.');
        }
      });

      // Edit
      card.querySelector('.edit-auto-btn').addEventListener('click', () => {
        openBuilder(auto);
      });

      // Delete
      card.querySelector('.delete-auto-btn').addEventListener('click', async () => {
        if (!confirm('Are you sure you want to delete this automation?')) return;
        try {
          await fetch(`/api/automations/${encodeURIComponent(auto.id)}`, {
            method: 'DELETE',
            headers: window.getAuthHeaders(),
            credentials: 'same-origin'
          });
          userAutomations = userAutomations.filter(a => a.id !== auto.id);
          renderAutomations();
          showNotice('Automation deleted.');
        } catch (e) {
          showError('Failed to delete automation.');
        }
      });

      automationsListGrid.appendChild(card);
    });
  }

  // Initial Data Load
  async function init() {
    try {
      // 1. Fetch Instagram Accounts
      const acctRes = await fetch('/api/instagram/accounts', {
        headers: window.getAuthHeaders(),
        credentials: 'same-origin'
      });
      const acctData = await acctRes.json().catch(() => ({}));
      userAccounts = acctData.accounts || [];

      if (userAccounts.length === 0) {
        if (noAccountWarning) noAccountWarning.hidden = false;
        if (openCreateBtn) openCreateBtn.disabled = true;
      } else {
        if (noAccountWarning) noAccountWarning.hidden = true;
        if (openCreateBtn) openCreateBtn.disabled = false;
        accountSelect.innerHTML = '';
        userAccounts.forEach(acct => {
          const opt = document.createElement('option');
          opt.value = acct.id;
          opt.textContent = `@${acct.username} (ID: ${acct.id})`;
          accountSelect.appendChild(opt);
        });
      }

      // 2. Fetch Automations
      const autoRes = await fetch('/api/automations', {
        headers: window.getAuthHeaders(),
        credentials: 'same-origin'
      });
      const autoData = await autoRes.json().catch(() => ({}));
      userAutomations = autoData.automations || [];
      renderAutomations();

      // Check URL query param e.g. ?action=new
      const params = new URLSearchParams(window.location.search);
      if (params.get('action') === 'new') {
        openBuilder(null);
      }
    } catch (e) {
      showError('Unable to load automations data.');
    }
  }

  init();
})();
