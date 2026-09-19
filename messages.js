(function () {
  var list = document.getElementById('messagesList');
  var refresh = document.getElementById('refreshMessages');
  if (!list) return;

  function escapeText(value) { return String(value || ''); }
  function render(events) {
    list.innerHTML = '';
    if (!events.length) {
      list.innerHTML = '<p class="muted">No message activity yet. Create an automation and receive a matching Instagram comment to see activity here.</p>';
      return;
    }
    events.forEach(function (event) {
      var item = document.createElement('article');
      item.className = 'activity-item';
      var title = event.eventType === 'private_reply' ? 'Private reply' : 'Comment received';
      var status = event.status ? ' · ' + event.status : '';
      item.innerHTML = '<div><strong></strong><p class="muted"></p><small class="muted"></small></div>';
      item.querySelector('strong').textContent = title + status;
      item.querySelector('p').textContent = event.messageText || (event.keyword ? 'Keyword: ' + event.keyword : 'Instagram activity recorded');
      item.querySelector('small').textContent = event.createdAt ? new Date(event.createdAt).toLocaleString() : '';
      if (event.errorMessage) {
        var error = document.createElement('p');
        error.className = 'muted';
        error.textContent = 'Error: ' + event.errorMessage;
        item.querySelector('div').appendChild(error);
      }
      list.appendChild(item);
    });
  }

  async function load() {
    list.innerHTML = '<p class="muted">Loading messages...</p>';
    if (refresh) refresh.disabled = true;
    try {
      var response = await fetch('/api/analytics/overview', { credentials: 'same-origin' });
      var data = await response.json().catch(function () { return {}; });
      if (!response.ok) throw new Error(data.error || 'Unable to load message activity.');
      render(data.recent || []);
    } catch (error) {
      list.innerHTML = '';
      var message = document.createElement('p');
      message.className = 'muted';
      message.textContent = error.message;
      list.appendChild(message);
    } finally {
      if (refresh) refresh.disabled = false;
    }
  }

  if (refresh) refresh.addEventListener('click', load);
  load();
})();
