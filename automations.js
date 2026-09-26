// ============================================================
// Comment2DM — Automations Engine & Reel Picker Flow
// Zero-lag, visual Reel selector, live simulator & clean state
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
  const simReelHeader = document.getElementById('simReelHeader');

  const keywordInput = document.getElementById('automationKeywordInput');
  const dmMessageInput = document.getElementById('automationDmMessageInput');
  const publicReplyInput = document.getElementById('automationPublicReplyInput');
  const automationIdInput = document.getElementById('automationId');

  // Specific reel vs all reels toggle
  const targetAllBtn = document.getElementById('targetAllReelsBtn');
  const targetSpecificBtn = document.getElementById('targetSpecificReelBtn');
  const reelPickerBox = document.getElementById('reelPickerBox');
  const reelPickerGrid = document.getElementById('reelPickerGrid');
  const refreshReelsBtn = document.getElementById('refreshReelsBtn');
  const reelsCountLabel = document.getElementById('reelsCountLabel');
  const selectedMediaIdInput = document.getElementById('selectedMediaId');
  const selectedMediaUrlInput = document.getElementById('selectedMediaUrl');

  // Selected reel showcase elements
  const selectedReelPreview = document.getElementById('selectedReelPreview');
  const selectedReelThumb = document.getElementById('selectedReelThumb');
  const selectedReelCaption = document.getElementById('selectedReelCaption');
  const selectedReelPermalink = document.getElementById('selectedReelPermalink');
  const selectedReelIdTag = document.getElementById('selectedReelIdTag');
  const clearReelSelectionBtn = document.getElementById('clearReelSelectionBtn');

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
    const isAll = triggerAllRadio ? triggerAllRadio.checked : false;
    const kw = keywordInput.value.trim() || 'LINK';
    const dm = dmMessageInput.value.trim() || 'Hey! Thanks for commenting. Here is your direct link: https://yourbrand.com/deal 🔥';
    const reply = publicReplyInput.value.trim();

    if (simComment) {
      simComment.innerHTML = isAll
        ? '💬 "Awesome video! 🔥"'
        : `💬 "Can you send the <strong>${kw.split(',')[0].trim().toUpperCase()}</strong>?"`;
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
      clearSelectedReel();
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

  function clearSelectedReel() {
    selectedMediaIdInput.value = '';
    selectedMediaUrlInput.value = '';
    if (selectedReelPreview) selectedReelPreview.style.display = 'none';
    if (simReelHeader) simReelHeader.textContent = 'Instagram Reel';
    document.querySelectorAll('.reel-choice-card').forEach(c => c.classList.remove('selected'));
  }

  if (clearReelSelectionBtn) {
    clearReelSelectionBtn.addEventListener('click', clearSelectedReel);
  }

  // Load published reels from Meta API
  async function loadReelsForSelectedAccount(force = false) {
    const igUserId = accountSelect.value;
    if (!igUserId) return;

    reelPickerGrid.innerHTML = '<div style="text-align:center; padding:24px; color:var(--ink-muted); grid-column:1/-1;">Loading reels & posts from Instagram…</div>';

    try {
      const res = await fetch(`/api/instagram/accounts/${encodeURIComponent(igUserId)}/reels${force ? '?refresh=1' : ''}`, {
        headers: window.getAuthHeaders(),
        credentials: 'same-origin'
      });
      const data = await res.json().catch(() => ({}));
      loadedReels = data.reels || [];

      if (reelsCountLabel) {
        reelsCountLabel.textContent = `${loadedReels.length} found`;
      }

      if (loadedReels.length === 0) {
        reelPickerGrid.innerHTML = '<div style="text-align:center; padding:24px; color:var(--ink-muted); grid-column:1/-1;">No Reels or Posts found for this account. Create one on Instagram to target it specifically!</div>';
        return;
      }

      reelPickerGrid.innerHTML = '';
      loadedReels.forEach(reel => {
        const card = document.createElement('div');
        card.className = 'reel-choice-card';
        if (selectedMediaIdInput.value === String(reel.id)) {
          card.classList.add('selected');
        }

        const thumb = reel.thumbnailUrl || 'https://placehold.co/180x320/121217/6366f1?text=Reel';
        const title = (reel.caption || 'Instagram Post').slice(0, 36);
        const isReel = (reel.mediaType === 'VIDEO') || (reel.mediaProductType === 'REELS');

        card.innerHTML = `
          <img src="${thumb}" class="reel-thumb-img" alt="Reel thumbnail" loading="lazy" />
          <div class="reel-choice-badge">${isReel ? '🎬' : '📸'} ${reel.commentsCount || 0}</div>
        `;

        card.addEventListener('click', () => {
          document.querySelectorAll('.reel-choice-card').forEach(c => c.classList.remove('selected'));
          card.classList.add('selected');
          selectReel(reel);
        });

        reelPickerGrid.appendChild(card);
      });
    } catch (e) {
      reelPickerGrid.innerHTML = '<div style="text-align:center; padding:24px; color:var(--rose); grid-column:1/-1;">Failed to load reels. Check your Instagram connection.</div>';
    }
  }

  function selectReel(reel) {
    if (!reel) return;
    selectedMediaIdInput.value = reel.id;
    selectedMediaUrlInput.value = reel.permalink || '';

    if (selectedReelPreview) {
      selectedReelPreview.style.display = 'flex';
      if (selectedReelThumb) {
        selectedReelThumb.src = reel.thumbnailUrl || 'https://placehold.co/180x320/121217/6366f1?text=Reel';
      }
      if (selectedReelCaption) {
        selectedReelCaption.textContent = reel.caption || 'Instagram Reel/Post';
      }
      if (selectedReelIdTag) {
        selectedReelIdTag.textContent = `ID: ${reel.id}`;
      }
      if (selectedReelPermalink) {
        selectedReelPermalink.href = reel.permalink || '#';
        selectedReelPermalink.style.display = reel.permalink ? 'inline-flex' : 'none';
      }
    }

    if (simReelHeader) {
      simReelHeader.textContent = reel.caption ? `Reel: "${reel.caption.slice(0, 20)}…"` : 'Instagram Reel';
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

    // Reset all form inputs completely so old/deleted data never leaks
    automationForm.reset();
    clearSelectedReel();

    automationFormCard.hidden = false;
    automationFormCard.style.display = 'block';
    automationFormCard.scrollIntoView({ behavior: 'smooth' });

    if (automation) {
      // EDIT MODE
      document.getElementById('formHeadingTitle').textContent = 'Edit Automation';
      automationIdInput.value = automation.id || '';
      accountSelect.value = automation.instagramUserId || (userAccounts[0] && userAccounts[0].id) || '';
      keywordInput.value = (automation.keyword === '*' ? '' : (automation.keyword || ''));
      dmMessageInput.value = automation.dmMessage || '';
      publicReplyInput.value = automation.replyTemplate || '';
      document.getElementById('automationEnabledCheckbox').checked = Boolean(automation.enabled);

      if (automation.triggerType === 'all' || automation.keyword === '*') {
        triggerAllRadio.checked = true;
        keywordGroup.style.display = 'none';
      } else {
        triggerKeywordRadio.checked = true;
        keywordGroup.style.display = 'block';
      }

      if (automation.mediaId || automation.mediaUrl) {
        targetSpecificBtn.classList.add('active');
        targetSpecificBtn.style.borderColor = 'var(--accent)';
        targetAllBtn.classList.remove('active');
        targetAllBtn.style.borderColor = 'transparent';
        reelPickerBox.style.display = 'block';

        selectedMediaIdInput.value = automation.mediaId || '';
        selectedMediaUrlInput.value = automation.mediaUrl || '';

        // Pre-fill selected reel showcase
        selectReel({
          id: automation.mediaId,
          permalink: automation.mediaUrl,
          caption: 'Linked Instagram Reel',
          thumbnailUrl: 'https://placehold.co/180x320/121217/6366f1?text=Reel'
        });

        loadReelsForSelectedAccount(false);
      } else {
        targetAllBtn.classList.add('active');
        targetAllBtn.style.borderColor = 'var(--accent)';
        targetSpecificBtn.classList.remove('active');
        targetSpecificBtn.style.borderColor = 'transparent';
        reelPickerBox.style.display = 'none';
      }
    } else {
      // BRAND NEW AUTOMATION MODE
      document.getElementById('formHeadingTitle').textContent = 'Create New Automation';
      automationIdInput.value = '';
      keywordInput.value = '';
      dmMessageInput.value = '';
      publicReplyInput.value = 'Sent to your DM! Check inbox 📩';
      document.getElementById('automationEnabledCheckbox').checked = true;
      triggerKeywordRadio.checked = true;
      keywordGroup.style.display = 'block';

      // Default: Specific Reel tab selected so creator sees their posts right away!
      targetSpecificBtn.classList.add('active');
      targetSpecificBtn.style.borderColor = 'var(--accent)';
      targetAllBtn.classList.remove('active');
      targetAllBtn.style.borderColor = 'transparent';
      reelPickerBox.style.display = 'block';

      // Load reels immediately for the default account
      if (userAccounts.length > 0) {
        accountSelect.value = userAccounts[0].id;
        loadReelsForSelectedAccount(false);
      }
    }

    updateSimulator();
  }

  function closeBuilder() {
    automationFormCard.hidden = true;
    automationFormCard.style.display = 'none';
    automationForm.reset();
    clearSelectedReel();
  }

  if (openCreateBtn) openCreateBtn.addEventListener('click', () => openBuilder(null));
  if (createFirstBtn) createFirstBtn.addEventListener('click', () => openBuilder(null));
  if (cancelFormBtn) cancelFormBtn.addEventListener('click', closeBuilder);
  if (cancelFormBtn2) cancelFormBtn2.addEventListener('click', closeBuilder);

  // Form Submission
  if (automationForm) {
    automationForm.addEventListener('submit', async function (e) {
      e.preventDefault();

      const id = automationIdInput.value.trim();
      const igUserId = accountSelect.value || (userAccounts[0] && userAccounts[0].id);
      const isAll = triggerAllRadio.checked;
      const kw = keywordInput.value.trim();
      const dm = dmMessageInput.value.trim();
      const reply = publicReplyInput.value.trim();
      const enabled = document.getElementById('automationEnabledCheckbox').checked;
      const mediaId = selectedMediaIdInput.value.trim();
      const mediaUrl = selectedMediaUrlInput.value.trim();

      if (!igUserId) {
        showError('Please connect an Instagram account first.');
        return;
      }
      if (!isAll && !kw) {
        showError('Please specify at least one trigger keyword (e.g. LINK).');
        keywordInput.focus();
        return;
      }
      if (!dm) {
        showError('Please write your automated Direct Message.');
        dmMessageInput.focus();
        return;
      }

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
            mediaId: mediaId || null,
            mediaUrl: mediaUrl || null
          })
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          showError(data.error || 'Failed to save automation.');
          saveBtn.disabled = false;
          saveBtn.innerHTML = '<span>Save & Launch Automation ⚡</span>';
          return;
        }

        const saved = data.automation;
        if (saved) {
          if (id) {
            userAutomations = userAutomations.map(a => (String(a.id) === String(id) ? saved : a));
          } else {
            userAutomations.unshift(saved);
          }
        } else {
          // Re-fetch clean list from backend
          const autoRes = await fetch('/api/automations', { headers: window.getAuthHeaders(), credentials: 'same-origin' });
          const autoData = await autoRes.json().catch(() => ({}));
          userAutomations = autoData.automations || [];
        }

        renderAutomations();
        closeBuilder();
        showNotice(id ? 'Automation updated successfully! ⚡' : 'Automation created and active! ⚡');
      } catch (err) {
        showError('Network error. Unable to save automation.');
      } finally {
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<span>Save & Launch Automation ⚡</span>';
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
      card.style.flexDirection = 'column';
      card.style.gap = '14px';
      card.style.padding = '20px 24px';
      card.id = `automation_card_${auto.id}`;

      const isAll = auto.triggerType === 'all' || auto.keyword === '*';
      const statusBadge = auto.enabled
        ? `<span class="plan-badge pro" style="color:var(--emerald);">● Active</span>`
        : `<span class="plan-badge free" style="color:var(--amber);">● Paused</span>`;

      let targetHtml = `<span class="plan-badge free">🎬 All Reels & Posts</span>`;
      if (auto.mediaId || auto.mediaUrl) {
        const link = auto.mediaUrl
          ? `<a href="${auto.mediaUrl}" target="_blank" rel="noopener" style="color:var(--accent-light); text-decoration:none; margin-left:6px;">View ↗</a>`
          : '';
        targetHtml = `<span class="plan-badge pro" style="background:rgba(99,102,241,0.12); color:var(--accent-light);">🎯 Specific Reel ${link}</span>`;
      }

      card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
          <div style="display:flex; align-items:center; gap:12px;">
            <div style="width:40px; height:40px; border-radius:50%; background:var(--accent-gradient); display:flex; align-items:center; justify-content:center; color:#fff; font-size:1.1rem; font-weight:700;">
              ${(auto.username || 'I').charAt(0).toUpperCase()}
            </div>
            <div>
              <div style="display:flex; align-items:center; gap:8px;">
                <strong style="color:#fff; font-size:0.95rem;">@${auto.username || 'Instagram'}</strong>
                ${statusBadge}
                ${targetHtml}
              </div>
              <div style="font-size:0.8rem; color:var(--ink-muted); margin-top:2px;">
                Trigger: ${isAll ? '<strong>Any Comment</strong>' : `Keyword <code>"${auto.keyword}"</code>`}
              </div>
            </div>
          </div>

          <div style="display:flex; align-items:center; gap:8px;">
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
        </div>

        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:14px; background:rgba(0,0,0,0.2); padding:12px 16px; border-radius:var(--radius-s); font-size:0.84rem;">
          <div>
            <span style="color:var(--ink-muted); display:block; margin-bottom:4px; font-size:0.75rem; text-transform:uppercase;">📩 Automated Direct Message</span>
            <div style="color:var(--ink-primary); line-height:1.4; word-break:break-word;">
              ${escapeHtml(auto.dmMessage || 'No message set')}
            </div>
          </div>
          <div>
            <span style="color:var(--ink-muted); display:block; margin-bottom:4px; font-size:0.75rem; text-transform:uppercase;">💬 Public Comment Reply</span>
            <div style="color:var(--ink-secondary); line-height:1.4; word-break:break-word;">
              ${auto.replyTemplate ? `↳ "${escapeHtml(auto.replyTemplate)}"` : '<em style="color:var(--ink-muted);">None (DM only)</em>'}
            </div>
          </div>
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
          showNotice(newEnabled ? 'Automation activated! ⚡' : 'Automation paused.');
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
        if (!confirm('Are you sure you want to delete this automation? It will permanently stop replying to comments.')) return;
        try {
          const res = await fetch(`/api/automations/${encodeURIComponent(auto.id)}`, {
            method: 'DELETE',
            headers: window.getAuthHeaders(),
            credentials: 'same-origin'
          });
          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.error || 'Failed to delete');
          }

          // Immediately remove from memory array
          userAutomations = userAutomations.filter(a => String(a.id) !== String(auto.id));

          // If currently editing this automation, close builder immediately
          if (automationIdInput.value === String(auto.id)) {
            closeBuilder();
          }

          // Instantly re-render without page reload
          renderAutomations();
          showNotice('Automation deleted successfully.');
        } catch (e) {
          showError('Failed to delete automation.');
        }
      });

      automationsListGrid.appendChild(card);
    });
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
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
