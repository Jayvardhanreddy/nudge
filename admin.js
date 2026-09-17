function cell(value) {
  const element = document.createElement('td');
  element.textContent = value || '—';
  return element;
}

async function loadAdminData() {
  const errorElement = document.getElementById('admin-error');
  try {
    const response = await fetch('/api/admin/overview', { credentials: 'include' });
    if (response.status === 401) {
      window.location.href = '/login.html';
      return;
    }
    if (response.status === 403) {
      errorElement.textContent = 'You do not have permission to view this page.';
      errorElement.hidden = false;
      return;
    }
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to load admin data.');
    document.getElementById('user-count').textContent = data.users.length;
    document.getElementById('account-count').textContent = data.instagramAccounts.length;
    for (const user of data.users) {
      const row = document.createElement('tr');
      row.append(cell(user.name), cell(user.email), cell(user.createdAt));
      document.getElementById('users').append(row);
    }
    for (const account of data.instagramAccounts) {
      const row = document.createElement('tr');
      row.append(cell(account.ownerUserId), cell(account.username), cell(account.instagramUserId), cell(account.expiresAt));
      document.getElementById('accounts').append(row);
    }
  } catch (error) {
    errorElement.textContent = error.message;
    errorElement.hidden = false;
  }
}

loadAdminData();
